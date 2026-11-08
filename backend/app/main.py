from fastapi import FastAPI, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import (
    create_engine, String, ForeignKey, DateTime,
    UniqueConstraint, or_, desc, inspect, text
)
from sqlalchemy.orm import (
    DeclarativeBase, sessionmaker, Session,
    Mapped, mapped_column
)
from pwdlib import PasswordHash
from datetime import datetime, timezone
import secrets
import string
import json
import base64
import re


# =========================
# DATABASE SETUP
# =========================

DATABASE_URL = "sqlite:///./meeting_zone.db"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False}
)

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    expire_on_commit=False
)


class Base(DeclarativeBase):
    pass


# =========================
# DATABASE MODELS
# =========================

class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    full_name: Mapped[str] = mapped_column(String(100))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))

    # Profile picture stored as a Base64 data URI
    profile_picture: Mapped[str | None] = mapped_column(
        String, nullable=True, default=None
    )


class Meeting(Base):
    __tablename__ = "meetings"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    title: Mapped[str] = mapped_column(String(100))
    meeting_code: Mapped[str] = mapped_column(
        String(20), unique=True, index=True
    )
    host_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )


class MeetingParticipant(Base):

    __tablename__ = "meeting_participants"

    __table_args__ = (
        UniqueConstraint("meeting_id", "user_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    meeting_id: Mapped[int] = mapped_column(ForeignKey("meetings.id"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    role: Mapped[str] = mapped_column(String(20), default="participant")


class MeetingChatMessage(Base):
    __tablename__ = "meeting_chat_messages"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    meeting_id: Mapped[int] = mapped_column(ForeignKey("meetings.id"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    message: Mapped[str] = mapped_column(String(2000))
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )


class DirectMessage(Base):
    __tablename__ = "direct_messages"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    sender_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    receiver_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    message: Mapped[str] = mapped_column(String(2000))
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )
    is_read: Mapped[bool] = mapped_column(default=False)


# Create tables without deleting existing data
Base.metadata.create_all(bind=engine)


# Add profile_picture column to an existing SQLite database.
# This migration does not delete or reset existing user records.
existing_columns = {
    column["name"] for column in inspect(engine).get_columns("users")
}

if "profile_picture" not in existing_columns:
    with engine.begin() as connection:
        connection.execute(
            text("ALTER TABLE users ADD COLUMN profile_picture TEXT")
        )


# =========================
# SECURITY
# =========================

password_hash = PasswordHash.recommended()


# =========================
# FASTAPI APPLICATION
# =========================

app = FastAPI(
    title="Meeting Zone API",
    description="Meeting Zone authentication, meetings, chat, profiles and WebRTC signaling",
    version="4.0.0"
)

# UPDATED CORS SETTINGS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://192.168.100.7:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =========================
# DATABASE CONNECTION
# =========================

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# =========================
# CONNECTION MANAGER
# =========================

class ConnectionManager:

    def __init__(self):
        # {meeting_code: {user_id: websocket}}
        self.rooms: dict[str, dict[int, WebSocket]] = {}

        # {user_id: websocket}
        self.private_connections: dict[int, WebSocket] = {}

    async def connect(self, meeting_code, user_id, websocket):
        await websocket.accept()

        room = self.rooms.setdefault(meeting_code, {})
        existing_users = list(room.keys())
        room[user_id] = websocket

        return existing_users

    def disconnect(self, meeting_code, user_id):
        room = self.rooms.get(meeting_code)

        if room and user_id in room:
            del room[user_id]

        if room is not None and not room:
            del self.rooms[meeting_code]

    async def send_personal(self, meeting_code, user_id, message):
        websocket = self.rooms.get(meeting_code, {}).get(user_id)

        if websocket:
            try:
                await websocket.send_json(message)
            except Exception:
                self.disconnect(meeting_code, user_id)

    async def broadcast(
        self,
        meeting_code,
        message,
        exclude_user_id=None
    ):
        room = self.rooms.get(meeting_code, {})

        for user_id, websocket in list(room.items()):
            if user_id == exclude_user_id:
                continue

            try:
                await websocket.send_json(message)
            except Exception:
                self.disconnect(meeting_code, user_id)

    async def connect_user(self, user_id, websocket):
        await websocket.accept()
        self.private_connections[user_id] = websocket

    def disconnect_user(self, user_id, websocket):
        current = self.private_connections.get(user_id)

        if current is websocket:
            del self.private_connections[user_id]

    async def send_user(self, user_id, message):
        websocket = self.private_connections.get(user_id)

        if websocket:
            try:
                await websocket.send_json(message)
            except Exception:
                self.private_connections.pop(user_id, None)


manager = ConnectionManager()


# =========================
# REQUEST MODELS
# =========================

class SignupRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=100)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class CreateMeetingRequest(BaseModel):
    title: str = Field(default="My Meeting", min_length=2, max_length=100)
    host_user_id: int


class JoinMeetingRequest(BaseModel):
    meeting_code: str = Field(min_length=3, max_length=20)
    user_id: int


class DirectMessageRequest(BaseModel):
    sender_id: int
    receiver_id: int
    message: str = Field(min_length=1, max_length=2000)


class ProfilePictureRequest(BaseModel):
    profile_picture: str = Field(min_length=1, max_length=2800000)


# =========================
# HELPER FUNCTIONS
# =========================

def user_data(user: User):
    return {
        "id": user.id,
        "full_name": user.full_name,
        "email": user.email,
        "profile_picture": user.profile_picture
    }


def generate_meeting_code(db: Session):
    alphabet = string.ascii_uppercase + string.digits

    for _ in range(10):
        code = "MZ-" + "".join(
            secrets.choice(alphabet) for _ in range(6)
        )

        existing = db.query(Meeting).filter(
            Meeting.meeting_code == code
        ).first()

        if not existing:
            return code

    raise HTTPException(
        status_code=500,
        detail="Could not generate meeting code"
    )


def verify_meeting_participant(db, meeting, user_id):
    participant = db.query(MeetingParticipant).filter(
        MeetingParticipant.meeting_id == meeting.id,
        MeetingParticipant.user_id == user_id
    ).first()

    if not participant:
        raise HTTPException(
            status_code=403,
            detail="You are not a participant of this meeting"
        )

    return participant


def format_message(message):
    return {
        "id": message.id,
        "message": message.message,
        "created_at": message.created_at.isoformat()
    }


def validate_profile_picture(value: str):
    """
    Accept only Base64 JPEG, PNG or WebP images.
    Maximum decoded image size: 2 MB.
    """

    pattern = (
        r"^data:image/(jpeg|png|webp);base64,"
        r"([A-Za-z0-9+/]+={0,2})$"
    )

    match = re.match(pattern, value)

    if not match:
        raise HTTPException(
            status_code=400,
            detail="Only JPEG, PNG and WebP profile pictures are allowed"
        )

    try:
        image_bytes = base64.b64decode(match.group(2), validate=True)
    except Exception:
        raise HTTPException(
            status_code=400,
            detail="Invalid profile picture data"
        )

    if len(image_bytes) > 2 * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail="Profile picture must be 2 MB or smaller"
        )

    if not image_bytes:
        raise HTTPException(
            status_code=400,
            detail="Empty profile picture"
        )

    return value


# =========================
# HOME AND HEALTH
# =========================

@app.get("/")
def home():
    return {
        "message": "Welcome to Meeting Zone API!",
        "status": "running"
    }


@app.get("/api/health")
def health_check():
    return {
        "status": "healthy",
        "service": "Meeting Zone Backend"
    }


# =========================
# SIGNUP
# =========================

@app.post("/api/signup", status_code=201)
def signup(data: SignupRequest, db: Session = Depends(get_db)):

    existing_user = db.query(User).filter(
        User.email == data.email
    ).first()

    if existing_user:
        raise HTTPException(
            status_code=409,
            detail="Email already registered"
        )

    user = User(
        full_name=data.full_name,
        email=data.email,
        password_hash=password_hash.hash(data.password)
    )

    db.add(user)
    db.commit()
    db.refresh(user)

    return {
        "message": "Account created successfully",
        "user": user_data(user)
    }


# =========================
# LOGIN
# =========================

@app.post("/api/login")
def login(data: LoginRequest, db: Session = Depends(get_db)):

    user = db.query(User).filter(
        User.email == data.email
    ).first()

    if not user or not password_hash.verify(
        data.password, user.password_hash
    ):
        raise HTTPException(
            status_code=401,
            detail="Invalid email or password"
        )

    return {
        "message": "Login successful",
        "user": user_data(user)
    }


# =========================
# PROFILE: GET USER
# =========================

@app.get("/api/users/{user_id}")
def get_user_profile(
    user_id: int,
    db: Session = Depends(get_db)
):
    user = db.query(User).filter(User.id == user_id).first()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    return {"user": user_data(user)}


# =========================
# PROFILE: UPDATE PROFILE PICTURE
# =========================

@app.put("/api/users/{user_id}/profile-picture")
def update_profile_picture(
    user_id: int,
    data: ProfilePictureRequest,
    db: Session = Depends(get_db)
):
    user = db.query(User).filter(User.id == user_id).first()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    picture = validate_profile_picture(data.profile_picture)

    user.profile_picture = picture

    db.commit()
    db.refresh(user)

    return {
        "message": "Profile picture updated successfully",
        "user": user_data(user)
    }


# =========================
# PROFILE: REMOVE PICTURE
# =========================

@app.delete("/api/users/{user_id}/profile-picture")
def remove_profile_picture(
    user_id: int,
    db: Session = Depends(get_db)
):
    user = db.query(User).filter(User.id == user_id).first()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.profile_picture = None
    db.commit()

    return {
        "message": "Profile picture removed successfully",
        "user": user_data(user)
    }


# =========================
# CREATE MEETING
# =========================

@app.post("/api/meetings", status_code=201)
def create_meeting(
    data: CreateMeetingRequest,
    db: Session = Depends(get_db)
):
    host = db.query(User).filter(
        User.id == data.host_user_id
    ).first()

    if not host:
        raise HTTPException(status_code=404, detail="Host not found")

    meeting = Meeting(
        title=data.title,
        meeting_code=generate_meeting_code(db),
        host_id=host.id
    )

    db.add(meeting)
    db.flush()

    participant = MeetingParticipant(
        meeting_id=meeting.id,
        user_id=host.id,
        role="host"
    )

    db.add(participant)
    db.commit()
    db.refresh(meeting)

    return {
        "message": "Meeting created successfully",
        "meeting": {
            "id": meeting.id,
            "title": meeting.title,
            "meeting_code": meeting.meeting_code,
            "host_id": meeting.host_id,
            "host_name": host.full_name,
            "role": "host",
            "created_at": meeting.created_at.isoformat()
        }
    }


# =========================
# JOIN MEETING
# =========================

@app.post("/api/meetings/join")
def join_meeting(
    data: JoinMeetingRequest,
    db: Session = Depends(get_db)
):
    user = db.query(User).filter(
        User.id == data.user_id
    ).first()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    meeting = db.query(Meeting).filter(
        Meeting.meeting_code == data.meeting_code.upper()
    ).first()

    if not meeting:
        raise HTTPException(
            status_code=404,
            detail="Meeting not found. Check the meeting code."
        )

    existing = db.query(MeetingParticipant).filter(
        MeetingParticipant.meeting_id == meeting.id,
        MeetingParticipant.user_id == user.id
    ).first()

    if not existing:
        participant = MeetingParticipant(
            meeting_id=meeting.id,
            user_id=user.id,
            role="participant"
        )
        db.add(participant)
        db.commit()

    return {
        "message": "Meeting joined successfully",
        "meeting": {
            "id": meeting.id,
            "title": meeting.title,
            "meeting_code": meeting.meeting_code,
            "host_id": meeting.host_id,
            "your_role": (
                "host" if meeting.host_id == user.id else "participant"
            )
        }
    }


# =========================
# GET USER MEETINGS
# =========================

@app.get("/api/meetings/user/{user_id}")
def get_user_meetings(
    user_id: int,
    db: Session = Depends(get_db)
):
    user = db.query(User).filter(User.id == user_id).first()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    participations = db.query(MeetingParticipant).filter(
        MeetingParticipant.user_id == user_id
    ).all()

    results = []

    for participation in participations:
        meeting = db.query(Meeting).filter(
            Meeting.id == participation.meeting_id
        ).first()

        if meeting:
            host = db.query(User).filter(
                User.id == meeting.host_id
            ).first()

            results.append({
                "id": meeting.id,
                "title": meeting.title,
                "meeting_code": meeting.meeting_code,
                "host_id": meeting.host_id,
                "host_name": host.full_name if host else "Unknown",
                "role": participation.role,
                "created_at": meeting.created_at.isoformat()
            })

    return {"meetings": results}


# =========================
# MEETING CHAT HISTORY
# =========================

@app.get("/api/meetings/{meeting_code}/messages")
def get_meeting_messages(
    meeting_code: str,
    user_id: int,
    db: Session = Depends(get_db)
):
    meeting = db.query(Meeting).filter(
        Meeting.meeting_code == meeting_code.strip().upper()
    ).first()

    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    verify_meeting_participant(db, meeting, user_id)

    messages = db.query(MeetingChatMessage).filter(
        MeetingChatMessage.meeting_id == meeting.id
    ).order_by(MeetingChatMessage.created_at.asc()).all()

    results = []

    for message in messages:
        sender = db.query(User).filter(
            User.id == message.user_id
        ).first()

        results.append({
            **format_message(message),
            "user_id": message.user_id,
            "full_name": sender.full_name if sender else "Unknown",
            "profile_picture": (
                sender.profile_picture if sender else None
            )
        })

    return {"messages": results}


# =========================
# PRIVATE MESSAGING: USER LIST
# =========================

@app.get("/api/users")
def get_users(
    current_user_id: int,
    db: Session = Depends(get_db)
):
    current_user = db.query(User).filter(
        User.id == current_user_id
    ).first()

    if not current_user:
        raise HTTPException(status_code=404, detail="User not found")

    users = db.query(User).filter(
        User.id != current_user_id
    ).order_by(User.full_name.asc()).all()

    return {
        "users": [user_data(user) for user in users]
    }


# =========================
# PRIVATE MESSAGING: CONVERSATIONS
# =========================

@app.get("/api/messages/conversations/{user_id}")
def get_conversations(
    user_id: int,
    db: Session = Depends(get_db)
):
    user = db.query(User).filter(User.id == user_id).first()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    messages = db.query(DirectMessage).filter(
        or_(
            DirectMessage.sender_id == user_id,
            DirectMessage.receiver_id == user_id
        )
    ).order_by(desc(DirectMessage.created_at)).all()

    conversations = {}

    for message in messages:
        other_user_id = (
            message.receiver_id
            if message.sender_id == user_id
            else message.sender_id
        )

        if other_user_id in conversations:
            continue

        other_user = db.query(User).filter(
            User.id == other_user_id
        ).first()

        unread_count = db.query(DirectMessage).filter(
            DirectMessage.sender_id == other_user_id,
            DirectMessage.receiver_id == user_id,
            DirectMessage.is_read == False
        ).count()

        conversations[other_user_id] = {
            "user_id": other_user_id,
            "full_name": (
                other_user.full_name if other_user else "Unknown"
            ),
            "profile_picture": (
                other_user.profile_picture if other_user else None
            ),
            "last_message": message.message,
            "created_at": message.created_at.isoformat(),
            "unread_count": unread_count
        }

    return {
        "conversations": list(conversations.values())
    }


# =========================
# PRIVATE MESSAGING: CHAT HISTORY
# =========================

@app.get("/api/messages/{user_id}/{other_user_id}")
def get_private_messages(
    user_id: int,
    other_user_id: int,
    db: Session = Depends(get_db)
):
    user = db.query(User).filter(User.id == user_id).first()
    other_user = db.query(User).filter(
        User.id == other_user_id
    ).first()

    if not user or not other_user:
        raise HTTPException(status_code=404, detail="User not found")

    messages = db.query(DirectMessage).filter(
        or_(
            (
                (DirectMessage.sender_id == user_id) &
                (DirectMessage.receiver_id == other_user_id)
            ),
            (
                (DirectMessage.sender_id == other_user_id) &
                (DirectMessage.receiver_id == user_id)
            )
        )
    ).order_by(DirectMessage.created_at.asc()).all()

    db.query(DirectMessage).filter(
        DirectMessage.sender_id == other_user_id,
        DirectMessage.receiver_id == user_id,
        DirectMessage.is_read == False
    ).update({"is_read": True})

    db.commit()

    results = []

    for message in messages:
        sender = db.query(User).filter(
            User.id == message.sender_id
        ).first()

        results.append({
            **format_message(message),
            "sender_id": message.sender_id,
            "sender_name": sender.full_name if sender else "Unknown",
            "sender_profile_picture": (
                sender.profile_picture if sender else None
            ),
            "receiver_id": message.receiver_id,
            "is_read": message.is_read
        })

    return {"messages": results}


# =========================
# PRIVATE MESSAGING: SEND MESSAGE
# =========================

@app.post("/api/messages", status_code=201)
async def send_private_message(
    data: DirectMessageRequest,
    db: Session = Depends(get_db)
):
    sender = db.query(User).filter(
        User.id == data.sender_id
    ).first()

    receiver = db.query(User).filter(
        User.id == data.receiver_id
    ).first()

    if not sender or not receiver:
        raise HTTPException(status_code=404, detail="User not found")

    if data.sender_id == data.receiver_id:
        raise HTTPException(
            status_code=400,
            detail="You cannot send a message to yourself"
        )

    clean_message = data.message.strip()

    if not clean_message:
        raise HTTPException(
            status_code=400,
            detail="Message cannot be empty"
        )

    message = DirectMessage(
        sender_id=sender.id,
        receiver_id=receiver.id,
        message=clean_message
    )

    db.add(message)
    db.commit()
    db.refresh(message)

    message_data = {
        **format_message(message),
        "sender_id": sender.id,
        "sender_name": sender.full_name,
        "sender_profile_picture": sender.profile_picture,
        "receiver_id": receiver.id,
        "is_read": False
    }

    await manager.send_user(
        receiver.id,
        {
            "type": "private-message",
            "message": message_data
        }
    )

    return {
        "message": "Message sent successfully",
        "data": message_data
    }


# =========================
# PRIVATE USER WEBSOCKET
# =========================

@app.websocket("/ws/users/{user_id}")
async def private_user_socket(
    websocket: WebSocket,
    user_id: int
):
    db = SessionLocal()

    try:
        user = db.query(User).filter(User.id == user_id).first()

        if not user:
            await websocket.close(
                code=1008,
                reason="User not found"
            )
            return
    finally:
        db.close()

    await manager.connect_user(user_id, websocket)

    try:
        await websocket.send_json({
            "type": "connected",
            "user_id": user_id,
            "message": "Private messaging connected"
        })

        while True:
            await websocket.receive_text()

    except WebSocketDisconnect:
        pass

    except Exception as error:
        print(f"Private WebSocket error for user {user_id}: {error}")

    finally:
        manager.disconnect_user(user_id, websocket)


# =========================
# MEETING WEBSOCKET
# WEBRTC SIGNALING + LIVE CHAT
# =========================

@app.websocket("/ws/meetings/{meeting_code}")
async def meeting_signaling(
    websocket: WebSocket,
    meeting_code: str,
    user_id: int
):
    meeting_code = meeting_code.strip().upper()

    db = SessionLocal()

    try:
        user = db.query(User).filter(
            User.id == user_id
        ).first()

        meeting = db.query(Meeting).filter(
            Meeting.meeting_code == meeting_code
        ).first()

        participant = None

        if meeting:
            participant = db.query(MeetingParticipant).filter(
                MeetingParticipant.meeting_id == meeting.id,
                MeetingParticipant.user_id == user_id
            ).first()

        if not user or not meeting or not participant:
            await websocket.close(
                code=1008,
                reason="Not authorized for this meeting"
            )
            return

        user_name = user.full_name
        user_picture = user.profile_picture
        meeting_id = meeting.id
        host_id = meeting.host_id

    finally:
        db.close()

    existing_users = await manager.connect(
        meeting_code,
        user_id,
        websocket
    )

    try:
        await websocket.send_json({
            "type": "room-users",
            "users": existing_users
        })

        await manager.broadcast(
            meeting_code,
            {
                "type": "user-joined",
                "user_id": user_id
            },
            exclude_user_id=user_id
        )

        while True:
            raw_message = await websocket.receive_text()

            try:
                data = json.loads(raw_message)
            except json.JSONDecodeError:
                await websocket.send_json({
                    "type": "error",
                    "message": "Invalid JSON message"
                })
                continue

            message_type = data.get("type")

            # -------------------------
            # WEBRTC SIGNALING
            # -------------------------

            if message_type in ("offer", "answer", "ice-candidate"):

                target_user_id = data.get("target_user_id")
                payload = data.get("payload")

                if not isinstance(target_user_id, int):
                    await websocket.send_json({
                        "type": "error",
                        "message": "Invalid target user"
                    })
                    continue

                if target_user_id == user_id:
                    continue

                if target_user_id not in manager.rooms.get(
                    meeting_code, {}
                ):
                    await websocket.send_json({
                        "type": "error",
                        "message": "Target user is not connected"
                    })
                    continue

                await manager.send_personal(
                    meeting_code,
                    target_user_id,
                    {
                        "type": message_type,
                        "from_user_id": user_id,
                        "payload": payload
                    }
                )

            # -------------------------
            # SEND MEETING CHAT MESSAGE
            # -------------------------

            elif message_type == "chat":

                chat_text = data.get("message")

                if not isinstance(chat_text, str):
                    await websocket.send_json({
                        "type": "error",
                        "message": "Invalid chat message"
                    })
                    continue

                chat_text = chat_text.strip()

                if not chat_text or len(chat_text) > 2000:
                    await websocket.send_json({
                        "type": "error",
                        "message": (
                            "Message must be between 1 and 2000 characters"
                        )
                    })
                    continue

                chat_db = SessionLocal()

                try:
                    chat_message = MeetingChatMessage(
                        meeting_id=meeting_id,
                        user_id=user_id,
                        message=chat_text
                    )

                    chat_db.add(chat_message)
                    chat_db.commit()
                    chat_db.refresh(chat_message)

                    message_data = {
                        "type": "chat-message",
                        "id": chat_message.id,
                        "user_id": user_id,
                        "full_name": user_name,
                        "profile_picture": user_picture,
                        "message": chat_message.message,
                        "created_at": chat_message.created_at.isoformat()
                    }

                finally:
                    chat_db.close()

                await manager.broadcast(
                    meeting_code,
                    message_data
                )

            # -------------------------
            # HOST DELETE CHAT MESSAGE
            # -------------------------

            elif message_type == "chat-delete":

                if user_id != host_id:
                    await websocket.send_json({
                        "type": "error",
                        "message": (
                            "Only the meeting host can delete messages"
                        )
                    })
                    continue

                message_id = data.get("message_id")

                if not isinstance(message_id, int):
                    await websocket.send_json({
                        "type": "error",
                        "message": "Invalid message ID"
                    })
                    continue

                delete_db = SessionLocal()

                try:
                    chat_message = delete_db.query(
                        MeetingChatMessage
                    ).filter(
                        MeetingChatMessage.id == message_id,
                        MeetingChatMessage.meeting_id == meeting_id
                    ).first()

                    if not chat_message:
                        await websocket.send_json({
                            "type": "error",
                            "message": "Message not found"
                        })
                        continue

                    delete_db.delete(chat_message)
                    delete_db.commit()

                finally:
                    delete_db.close()

                await manager.broadcast(
                    meeting_code,
                    {
                        "type": "chat-deleted",
                        "message_id": message_id,
                        "deleted_by": user_id
                    }
                )

            # -------------------------
            # LEAVE MEETING
            # -------------------------

            elif message_type == "leave":
                break

            else:
                await websocket.send_json({
                    "type": "error",
                    "message": "Unsupported message type"
                })

    except WebSocketDisconnect:
        pass

    except Exception as error:
        print(f"Meeting WebSocket error for user {user_id}: {error}")

    finally:
        manager.disconnect(meeting_code, user_id)

        await manager.broadcast(
            meeting_code,
            {
                "type": "user-left",
                "user_id": user_id
            }
        )