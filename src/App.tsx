import { useEffect, useRef, useState } from "react";
import api from "./services/api";
import {
  Video, VideoOff, Mic, MicOff, PhoneOff, Globe2, Languages,
  ShieldCheck, ArrowRight, Eye, EyeOff, User, Users, Plus,
  LogOut, CalendarDays, Copy, Monitor, MessageCircle, Send,
  Trash2, ImagePlus, X, RefreshCw
} from "lucide-react";
import "./index.css";

interface UserData {
  id: number;
  full_name: string;
  email: string;
  profile_picture?: string | null;
}

interface AuthResponse {
  message: string;
  user: UserData;
}

interface Meeting {
  id: number;
  title: string;
  meeting_code: string;
  host_id: number;
  host_name?: string;
  role: string;
  created_at: string;
}

interface MeetingResponse {
  message: string;
  meeting: Meeting;
}

interface ChatMessage {
  id: number;
  sender_id: number;
  user_id?: number;
  sender_name?: string;
  full_name?: string;
  message: string;
  created_at?: string;
  profile_picture?: string | null;
}

interface DirectMessage {
  id: number;
  sender_id: number;
  receiver_id: number;
  message: string;
  created_at?: string;
  sender_name?: string;
  profile_picture?: string | null;
  is_read?: boolean;
}

interface Participant {
  userId: number;
  stream: MediaStream;
}

// Use the same API host for WebSocket connections.
// This supports localhost, LAN and HTTPS deployment.
const API_BASE_URL = (
  api.defaults.baseURL ||
  `${window.location.protocol}//${window.location.hostname}:8000`
).replace(/\/+$/, "");

const WS_BASE = API_BASE_URL
  .replace(/^https:/, "wss:")
  .replace(/^http:/, "ws:");

function Avatar({
  picture,
  name,
  size = 42,
}: {
  picture?: string | null;
  name?: string;
  size?: number;
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        minWidth: size,
        borderRadius: "50%",
        overflow: "hidden",
        background: "#334155",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#fff",
      }}
    >
      {picture ? (
        <img
          src={picture}
          alt={name || "Profile"}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      ) : (
        <User size={size * 0.55} />
      )}
    </div>
  );
}

function RemoteVideo({
  stream,
  label,
}: {
  stream: MediaStream;
  label: string;
}) {
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div style={styles.videoTile}>
      <video
        ref={remoteVideoRef}
        autoPlay
        playsInline
        style={styles.video}
      />
      <span style={styles.videoLabel}>{label}</span>
    </div>
  );
}

function getErrorMessage(err: any): string {
  const detail = err.response?.data?.detail;

  if (typeof detail === "string") return detail;

  if (Array.isArray(detail)) {
    return detail.map((item: any) => item.msg).join(", ");
  }

  return err.message || "Something went wrong. Please try again.";
}

function normalizeDirectMessage(item: any): DirectMessage {
  return {
    id: Number(item.id),
    sender_id: Number(item.sender_id),
    receiver_id: Number(item.receiver_id),
    message: String(item.message || ""),
    created_at: item.created_at,
    sender_name: item.sender_name,
    profile_picture:
      item.profile_picture ??
      item.sender_profile_picture ??
      null,
    is_read: item.is_read,
  };
}

const styles: Record<string, React.CSSProperties> = {
  videoTile: {
    background: "#172033",
    borderRadius: 12,
    minHeight: 220,
    overflow: "hidden",
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  video: {
    width: "100%",
    height: "100%",
    minHeight: 220,
    objectFit: "contain",
  },
  videoLabel: {
    position: "absolute",
    bottom: 10,
    left: 10,
    background: "#0009",
    padding: "6px 10px",
    borderRadius: 7,
    color: "#fff",
    fontSize: 13,
  },
  panel: {
    background: "#172033",
    borderRadius: 14,
    padding: 16,
    color: "#fff",
  },
  field: {
    width: "100%",
    padding: 11,
    borderRadius: 8,
    border: "1px solid #475569",
    background: "#0f172a",
    color: "#fff",
    boxSizing: "border-box",
  },
  action: {
    border: 0,
    borderRadius: 9,
    padding: "11px 15px",
    background: "#2563eb",
    color: "#fff",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
};

export default function App() {
  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [showPassword, setShowPassword] = useState(false);
  const [language, setLanguage] = useState("English");

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [currentUser, setCurrentUser] = useState<UserData | null>(() => {
    try {
      const saved = localStorage.getItem("meetingZoneUser");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [showJoin, setShowJoin] = useState(false);
  const [meetingCode, setMeetingCode] = useState("");
  const [meetingLoading, setMeetingLoading] = useState(false);
  const [dashboardMessage, setDashboardMessage] = useState("");
  const [dashboardError, setDashboardError] = useState("");

  const [activeMeeting, setActiveMeeting] = useState<Meeting | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [roomError, setRoomError] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);

  const [remoteParticipants, setRemoteParticipants] = useState<Participant[]>([]);
  const [participantUsers, setParticipantUsers] = useState<UserData[]>([]);
  const [connectionStatus, setConnectionStatus] = useState("Connecting...");

  const socketRef = useRef<WebSocket | null>(null);
  const peerConnectionsRef = useRef<Map<number, RTCPeerConnection>>(new Map());
  const pendingCandidatesRef = useRef<Map<number, RTCIceCandidateInit[]>>(new Map());

  // Profile
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");
  const profileInputRef = useRef<HTMLInputElement>(null);

  // Meeting chat
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatText, setChatText] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Private chat
  const [allUsers, setAllUsers] = useState<UserData[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserData | null>(null);
  const [directMessages, setDirectMessages] = useState<DirectMessage[]>([]);
  const [directText, setDirectText] = useState("");
  const [directLoading, setDirectLoading] = useState(false);
  const [sendingDirect, setSendingDirect] = useState(false);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState("");
  const [usersRefreshKey, setUsersRefreshKey] = useState(0);
  const [privateSocketStatus, setPrivateSocketStatus] = useState("Connecting...");

  const privateSocketRef = useRef<WebSocket | null>(null);
  const directEndRef = useRef<HTMLDivElement>(null);
  const selectedUserRef = useRef<UserData | null>(null);

  selectedUserRef.current = selectedUser;

  // =========================
  // LOAD USER DATA
  // =========================

  useEffect(() => {
    if (!currentUser) return;

    let cancelled = false;

    const loadUserData = async () => {
      try {
        const [meetingResponse, userResponse] = await Promise.all([
          api.get(`/api/meetings/user/${currentUser.id}`),
          api.get(`/api/users/${currentUser.id}`),
        ]);

        if (cancelled) return;

        const meetingData = meetingResponse.data;
        const meetingList = Array.isArray(meetingData)
          ? meetingData
          : meetingData.meetings || [];

        setMeetings(meetingList);

        const updatedUser =
          userResponse.data.user || userResponse.data;

        setCurrentUser((previous) => {
          if (!previous) return previous;

          const merged = { ...previous, ...updatedUser };

          localStorage.setItem(
            "meetingZoneUser",
            JSON.stringify(merged)
          );

          return merged;
        });
      } catch (err: any) {
        if (!cancelled) {
          setDashboardError(getErrorMessage(err));
        }
      }
    };

    loadUserData();

    return () => {
      cancelled = true;
    };
  }, [currentUser?.id]);

  // =========================
  // LOAD ALL OTHER USERS
  // =========================

  const refreshUsers = () => {
    setUsersRefreshKey((value) => value + 1);
  };

  useEffect(() => {
    if (!currentUser) {
      setAllUsers([]);
      setParticipantUsers([]);
      return;
    }

    let cancelled = false;

    const loadUsers = async () => {
      setUsersLoading(true);
      setUsersError("");

      try {
        const response = await api.get(
          `/api/users?current_user_id=${currentUser.id}`
        );

        const result = response.data;

        const list: UserData[] = Array.isArray(result)
          ? result
          : Array.isArray(result.users)
            ? result.users
            : [];

        const otherUsers = list.filter(
          (person) =>
            Number(person.id) !== Number(currentUser.id)
        );

        if (!cancelled) {
          setAllUsers(otherUsers);
          setParticipantUsers(otherUsers);

          if (
            selectedUser &&
            !otherUsers.some(
              (person) => person.id === selectedUser.id
            )
          ) {
            setSelectedUser(null);
            setDirectMessages([]);
          }
        }
      } catch (err: any) {
        if (!cancelled) {
          setUsersError(getErrorMessage(err));
        }
      } finally {
        if (!cancelled) {
          setUsersLoading(false);
        }
      }
    };

    loadUsers();

    return () => {
      cancelled = true;
    };
  }, [currentUser?.id, usersRefreshKey]);

  // =========================
  // PROFILE PICTURE UPLOAD
  // =========================

  const uploadProfilePicture = async (file?: File) => {
    if (!file || !currentUser) return;

    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setProfileMessage("Please select a JPG, PNG or WebP image.");
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setProfileMessage("Image size must be 2 MB or less.");
      return;
    }

    setProfileLoading(true);
    setProfileMessage("");

    try {
      const reader = new FileReader();

      reader.onload = async () => {
        try {
          const response = await api.put(
            `/api/users/${currentUser.id}/profile-picture`,
            { profile_picture: reader.result }
          );

          const updated = response.data.user || response.data;

          const newPicture =
            updated.profile_picture ||
            reader.result?.toString() ||
            null;

          setCurrentUser((previous) => {
            if (!previous) return previous;

            const next = {
              ...previous,
              profile_picture: newPicture,
            };

            localStorage.setItem(
              "meetingZoneUser",
              JSON.stringify(next)
            );

            return next;
          });

          setProfileMessage("Profile picture updated successfully.");
        } catch (err: any) {
          setProfileMessage(getErrorMessage(err));
        } finally {
          setProfileLoading(false);
        }
      };

      reader.onerror = () => {
        setProfileMessage("Could not read this image.");
        setProfileLoading(false);
      };

      reader.readAsDataURL(file);
    } catch (err: any) {
      setProfileMessage(getErrorMessage(err));
      setProfileLoading(false);
    }
  };

  const removeProfilePicture = async () => {
    if (!currentUser) return;

    setProfileLoading(true);
    setProfileMessage("");

    try {
      await api.delete(
        `/api/users/${currentUser.id}/profile-picture`
      );

      setCurrentUser((previous) => {
        if (!previous) return previous;

        const next = {
          ...previous,
          profile_picture: null,
        };

        localStorage.setItem(
          "meetingZoneUser",
          JSON.stringify(next)
        );

        return next;
      });

      setProfileMessage("Profile picture removed.");
    } catch (err: any) {
      setProfileMessage(getErrorMessage(err));
    } finally {
      setProfileLoading(false);
    }
  };

  // =========================
  // CAMERA AND MICROPHONE
  // =========================

  useEffect(() => {
    if (!activeMeeting) return;

    let cancelled = false;
    let stream: MediaStream | null = null;

    const startMedia = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error(
            "Camera and microphone are not supported by this browser."
          );
        }

        const mediaStream =
          await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true,
          });

        if (cancelled) {
          mediaStream.getTracks().forEach((track) => track.stop());
          return;
        }

        stream = mediaStream;
        setLocalStream(mediaStream);
        setCameraOn(true);
        setMicOn(true);
        setRoomError("");
      } catch (err: any) {
        if (!cancelled) {
          setRoomError(
            err.message ||
            "Camera or microphone permission denied. Please allow access."
          );
        }
      }
    };

    startMedia();

    return () => {
      cancelled = true;

      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }

      setLocalStream(null);
      setCameraOn(false);
      setMicOn(false);
    };
  }, [activeMeeting]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  // =========================
  // MEETING CHAT HISTORY
  // =========================

  useEffect(() => {
    if (!activeMeeting || !currentUser) return;

    let cancelled = false;

    const loadChat = async () => {
      setChatLoading(true);

      try {
        const response = await api.get(
          `/api/meetings/${encodeURIComponent(
            activeMeeting.meeting_code
          )}/messages?user_id=${currentUser.id}`
        );

        const result = response.data;

        const list = Array.isArray(result)
          ? result
          : result.messages || [];

        if (!cancelled) {
          setChatMessages(list);
        }
      } catch (err: any) {
        if (!cancelled) {
          console.error(
            "Could not load meeting messages:",
            getErrorMessage(err)
          );
        }
      } finally {
        if (!cancelled) {
          setChatLoading(false);
        }
      }
    };

    loadChat();

    return () => {
      cancelled = true;
    };
  }, [activeMeeting?.meeting_code, currentUser?.id]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [chatMessages]);

  // =========================
  // WEBRTC + MEETING WEBSOCKET
  // =========================

  useEffect(() => {
    if (!activeMeeting || !currentUser || !localStream) return;

    const code = encodeURIComponent(activeMeeting.meeting_code);

    const socket = new WebSocket(
      `${WS_BASE}/ws/meetings/${code}?user_id=${currentUser.id}`
    );

    socketRef.current = socket;

    setConnectionStatus("Connecting to meeting server...");

    let disposed = false;

    const sendSignal = (message: Record<string, unknown>) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
      }
    };

    const flushPendingCandidates = async (
      peerId: number,
      pc: RTCPeerConnection
    ) => {
      const queued =
        pendingCandidatesRef.current.get(peerId) || [];

      pendingCandidatesRef.current.delete(peerId);

      for (const candidate of queued) {
        try {
          await pc.addIceCandidate(
            new RTCIceCandidate(candidate)
          );
        } catch (err) {
          console.error("Unable to add queued ICE candidate:", err);
        }
      }
    };

    const createPeerConnection = (peerId: number) => {
      const existing =
        peerConnectionsRef.current.get(peerId);

      if (existing) return existing;

      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
        ],
      });

      localStream.getTracks().forEach((track) => {
        pc.addTrack(track, localStream);
      });

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendSignal({
            type: "ice-candidate",
            target_user_id: peerId,
            payload: event.candidate.toJSON(),
          });
        }
      };

      pc.ontrack = (event) => {
        const incomingStream = event.streams[0];

        if (!incomingStream || disposed) return;

        setRemoteParticipants((previous) => [
          ...previous.filter(
            (item) => item.userId !== peerId
          ),
          {
            userId: peerId,
            stream: incomingStream,
          },
        ]);
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed") {
          setRoomError(
            "Connection failed. This network may need a TURN server."
          );
        }

        if (pc.connectionState === "connected") {
          setRoomError("");
        }
      };

      peerConnectionsRef.current.set(peerId, pc);

      return pc;
    };

    const createOffer = async (peerId: number) => {
      try {
        const pc = createPeerConnection(peerId);

        if (pc.signalingState !== "stable") return;

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        sendSignal({
          type: "offer",
          target_user_id: peerId,
          payload: pc.localDescription,
        });
      } catch (err) {
        console.error("Could not create WebRTC offer:", err);
        setRoomError(
          "Could not start a call with another participant."
        );
      }
    };

    socket.onopen = () => {
      setConnectionStatus("Connected to meeting server");
    };

    socket.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);

        if (message.type === "room-users") {
          const existingUsers: number[] = message.users || [];

          setConnectionStatus("Waiting for participants...");

          for (const peerId of existingUsers) {
            if (currentUser.id < peerId) {
              await createOffer(peerId);
            }
          }
        }

        if (message.type === "user-joined") {
          const peerId = Number(message.user_id);

          if (currentUser.id < peerId) {
            await createOffer(peerId);
          }
        }

        if (message.type === "offer") {
          const peerId = Number(message.from_user_id);
          const pc = createPeerConnection(peerId);

          await pc.setRemoteDescription(
            new RTCSessionDescription(message.payload)
          );

          await flushPendingCandidates(peerId, pc);

          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          sendSignal({
            type: "answer",
            target_user_id: peerId,
            payload: pc.localDescription,
          });
        }

        if (message.type === "answer") {
          const peerId = Number(message.from_user_id);
          const pc =
            peerConnectionsRef.current.get(peerId);

          if (pc) {
            await pc.setRemoteDescription(
              new RTCSessionDescription(message.payload)
            );

            await flushPendingCandidates(peerId, pc);
          }
        }

        if (message.type === "ice-candidate") {
          const peerId = Number(message.from_user_id);
          const pc =
            peerConnectionsRef.current.get(peerId);

          if (pc && pc.remoteDescription) {
            await pc.addIceCandidate(
              new RTCIceCandidate(message.payload)
            );
          } else {
            const queued =
              pendingCandidatesRef.current.get(peerId) || [];

            queued.push(message.payload);
            pendingCandidatesRef.current.set(peerId, queued);
          }
        }

        if (message.type === "chat-message") {
          const incoming =
            message.message_data ||
            message.data ||
            message;

          setChatMessages((previous) => {
            if (
              previous.some(
                (item) => item.id === incoming.id
              )
            ) {
              return previous;
            }

            return [
              ...previous,
              {
                ...incoming,
                sender_id: Number(
                  incoming.sender_id ?? incoming.user_id
                ),
                sender_name:
                  incoming.sender_name ??
                  incoming.full_name,
              },
            ];
          });
        }

        if (message.type === "chat-deleted") {
          const deletedId = Number(message.message_id);

          setChatMessages((previous) =>
            previous.filter(
              (item) => item.id !== deletedId
            )
          );
        }

        if (message.type === "user-left") {
          const peerId = Number(message.user_id);

          peerConnectionsRef.current.get(peerId)?.close();
          peerConnectionsRef.current.delete(peerId);
          pendingCandidatesRef.current.delete(peerId);

          setRemoteParticipants((previous) =>
            previous.filter(
              (item) => item.userId !== peerId
            )
          );
        }

        if (message.type === "error") {
          setRoomError(
            message.message ||
            "Meeting server returned an error."
          );
        }
      } catch (err) {
        console.error("Meeting signaling message error:", err);
      }
    };

    socket.onerror = () => {
      setConnectionStatus("Meeting server connection error");
      setRoomError(
        "Could not connect to meeting server. Check FastAPI."
      );
    };

    socket.onclose = () => {
      if (!disposed) {
        setConnectionStatus("Disconnected from meeting server");
      }
    };

    return () => {
      disposed = true;

      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "leave" }));
      }

      socket.close();

      if (socketRef.current === socket) {
        socketRef.current = null;
      }

      peerConnectionsRef.current.forEach((pc) => pc.close());
      peerConnectionsRef.current.clear();
      pendingCandidatesRef.current.clear();

      setRemoteParticipants([]);
    };
  }, [activeMeeting, currentUser, localStream]);

  // =========================
  // MEETING CHAT ACTIONS
  // =========================

  const quickMessages = [
    "Great meeting! 👍",
    "Nice! 😊",
    "Excellent work! 👏",
    "Bad meeting 👎",
    "Thank you! 🙏",
  ];

  const sendMeetingMessage = (messageText: string = chatText) => {
    const cleanMessage = messageText.trim();

    if (!cleanMessage) return;

    if (
      !socketRef.current ||
      socketRef.current.readyState !== WebSocket.OPEN
    ) {
      setRoomError(
        "Meeting chat is not connected yet. Please wait and try again."
      );
      return;
    }

    socketRef.current.send(
      JSON.stringify({
        type: "chat",
        message: cleanMessage,
      })
    );

    setChatText("");
  };

  const deleteMeetingMessage = (messageId: number) => {
    if (
      !socketRef.current ||
      activeMeeting?.host_id !== currentUser?.id
    ) {
      return;
    }

    if (socketRef.current.readyState !== WebSocket.OPEN) {
      setRoomError("Meeting connection is not available.");
      return;
    }

    socketRef.current.send(
      JSON.stringify({
        type: "chat-delete",
        message_id: messageId,
      })
    );
  };

  // =========================
  // PRIVATE MESSAGING WEBSOCKET
  // =========================

  useEffect(() => {
    if (!currentUser) return;

    let disposed = false;

    const socket = new WebSocket(
      `${WS_BASE}/ws/users/${currentUser.id}`
    );

    privateSocketRef.current = socket;
    setPrivateSocketStatus("Connecting...");

    socket.onopen = () => {
      if (!disposed) {
        setPrivateSocketStatus("Connected");
      }
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === "connected") {
          setPrivateSocketStatus("Connected");
          return;
        }

        const rawIncoming =
          data.message_data ??
          data.data ??
          (
            typeof data.message === "object"
              ? data.message
              : null
          );

        if (!rawIncoming || !rawIncoming.id) return;

        const incoming = normalizeDirectMessage(rawIncoming);
        const activeRecipient = selectedUserRef.current;

        // Only show messages belonging to the open conversation.
        if (
          activeRecipient &&
          (
            incoming.sender_id === activeRecipient.id ||
            incoming.receiver_id === activeRecipient.id
          )
        ) {
          setDirectMessages((previous) => {
            if (
              previous.some(
                (item) => item.id === incoming.id
              )
            ) {
              return previous;
            }

            return [...previous, incoming];
          });
        }

        // Refresh list so new conversations can appear.
        setUsersRefreshKey((value) => value + 1);
      } catch (err) {
        console.error("Private message socket error:", err);
      }
    };

    socket.onerror = () => {
      if (!disposed) {
        setPrivateSocketStatus("Connection error");
      }
    };

    socket.onclose = () => {
      if (!disposed) {
        setPrivateSocketStatus("Disconnected");
      }
    };

    return () => {
      disposed = true;

      socket.close();

      if (privateSocketRef.current === socket) {
        privateSocketRef.current = null;
      }

      setPrivateSocketStatus("Disconnected");
    };
  }, [currentUser?.id]);

  // =========================
  // PRIVATE CHAT HISTORY
  // =========================

  useEffect(() => {
    if (!currentUser || !selectedUser) {
      setDirectMessages([]);
      return;
    }

    let cancelled = false;

    const loadDirectMessages = async () => {
      setDirectLoading(true);

      try {
        const response = await api.get(
          `/api/messages/${currentUser.id}/${selectedUser.id}`
        );

        const result = response.data;

        const list = Array.isArray(result)
          ? result
          : result.messages || [];

        if (!cancelled) {
          setDirectMessages(
            list.map(normalizeDirectMessage)
          );
        }
      } catch (err: any) {
        if (!cancelled) {
          const message = getErrorMessage(err);
          console.error("Could not load private messages:", message);
          setDashboardError(message);
        }
      } finally {
        if (!cancelled) {
          setDirectLoading(false);
        }
      }
    };

    loadDirectMessages();

    return () => {
      cancelled = true;
    };
  }, [currentUser?.id, selectedUser?.id]);

  useEffect(() => {
    directEndRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [directMessages]);

  // =========================
  // SEND PRIVATE MESSAGE
  // =========================

  const sendDirectMessage = async () => {
    if (
      !currentUser ||
      !selectedUser ||
      !directText.trim() ||
      sendingDirect
    ) {
      return;
    }

    const messageText = directText.trim();
    const recipient = selectedUser;

    setSendingDirect(true);
    setDirectText("");

    try {
      const response = await api.post("/api/messages", {
        sender_id: currentUser.id,
        receiver_id: recipient.id,
        message: messageText,
      });

      const sentRaw =
        response.data.message_data ||
        response.data.data;

      if (sentRaw) {
        const sent = normalizeDirectMessage(sentRaw);

        setDirectMessages((previous) => {
          if (
            previous.some(
              (item) => item.id === sent.id
            )
          ) {
            return previous;
          }

          return [...previous, sent];
        });
      } else {
        // Fallback: reload conversation if server response has no message.
        const history = await api.get(
          `/api/messages/${currentUser.id}/${recipient.id}`
        );

        setDirectMessages(
          (history.data.messages || []).map(
            normalizeDirectMessage
          )
        );
      }

      setDashboardError("");
      setRoomError("");
      setUsersRefreshKey((value) => value + 1);
    } catch (err: any) {
      setDirectText(messageText);

      const message = getErrorMessage(err);

      if (activeMeeting) {
        setRoomError(message);
      } else {
        setDashboardError(message);
      }
    } finally {
      setSendingDirect(false);
    }
  };

  // =========================
  // SIGNUP / LOGIN
  // =========================

  const handleAuth = async (
    e: React.FormEvent<HTMLFormElement>
  ) => {
    e.preventDefault();

    setError("");
    setSuccess("");
    setLoading(true);

    try {
      let response;

      if (mode === "signup") {
        response = await api.post<AuthResponse>(
          "/api/signup",
          {
            full_name: fullName,
            email,
            password,
          }
        );

        setSuccess(response.data.message);
        setMode("login");
        setPassword("");
      } else {
        response = await api.post<AuthResponse>(
          "/api/login",
          {
            email,
            password,
          }
        );

        localStorage.setItem(
          "meetingZoneUser",
          JSON.stringify(response.data.user)
        );

        setCurrentUser(response.data.user);
        setPassword("");
      }
    } catch (err: any) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  // =========================
  // CREATE MEETING
  // =========================

  const createMeeting = async () => {
    if (!currentUser) return;

    setMeetingLoading(true);
    setDashboardMessage("");
    setDashboardError("");

    try {
      const response = await api.post<MeetingResponse>(
        "/api/meetings",
        {
          title: "My Meeting",
          host_user_id: currentUser.id,
        }
      );

      const newMeeting = response.data.meeting;

      setMeetings((previous) => [
        newMeeting,
        ...previous.filter(
          (meeting) => meeting.id !== newMeeting.id
        ),
      ]);

      setActiveMeeting(newMeeting);
    } catch (err: any) {
      setDashboardError(getErrorMessage(err));
    } finally {
      setMeetingLoading(false);
    }
  };

  // =========================
  // JOIN MEETING
  // =========================

  const joinMeeting = async () => {
    if (!currentUser || !meetingCode.trim()) {
      setDashboardError("Please enter a meeting code.");
      return;
    }

    setMeetingLoading(true);
    setDashboardMessage("");
    setDashboardError("");

    try {
      const enteredCode = meetingCode.trim().toUpperCase();

      const response = await api.post(
        "/api/meetings/join",
        {
          meeting_code: enteredCode,
          user_id: currentUser.id,
        }
      );

      const meetingsResponse = await api.get(
        `/api/meetings/user/${currentUser.id}`
      );

      const data = meetingsResponse.data;

      const meetingList: Meeting[] = Array.isArray(data)
        ? data
        : data.meetings || [];

      setMeetings(meetingList);

      const joinedMeeting = meetingList.find(
        (meeting) =>
          meeting.meeting_code === enteredCode
      );

      if (!joinedMeeting) {
        setDashboardMessage(
          response.data.message ||
          "Meeting joined successfully."
        );

        setDashboardError(
          "Meeting joined, but room details could not be loaded. Please refresh."
        );

        return;
      }

      setMeetingCode("");
      setShowJoin(false);
      setActiveMeeting(joinedMeeting);
    } catch (err: any) {
      setDashboardError(getErrorMessage(err));
    } finally {
      setMeetingLoading(false);
    }
  };

  // =========================
  // CAMERA / MIC CONTROLS
  // =========================

  const toggleCamera = () => {
    if (!localStream) return;

    const next = !cameraOn;

    localStream.getVideoTracks().forEach((track) => {
      track.enabled = next;
    });

    setCameraOn(next);
  };

  const toggleMic = () => {
    if (!localStream) return;

    const next = !micOn;

    localStream.getAudioTracks().forEach((track) => {
      track.enabled = next;
    });

    setMicOn(next);
  };

  // =========================
  // LEAVE MEETING
  // =========================

  const leaveMeeting = () => {
    const socket = socketRef.current;

    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "leave" }));
      socket.close();
    }

    socketRef.current = null;

    peerConnectionsRef.current.forEach((pc) => pc.close());
    peerConnectionsRef.current.clear();
    pendingCandidatesRef.current.clear();

    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
    }

    setRemoteParticipants([]);
    setLocalStream(null);
    setCameraOn(false);
    setMicOn(false);
    setRoomError("");
    setConnectionStatus("Left meeting");
    setActiveMeeting(null);
    setChatMessages([]);
    setChatText("");
  };

  // =========================
  // LOGOUT
  // =========================

  const logout = () => {
    leaveMeeting();

    privateSocketRef.current?.close();
    privateSocketRef.current = null;

    localStorage.removeItem("meetingZoneUser");

    setCurrentUser(null);
    setMeetings([]);
    setAllUsers([]);
    setParticipantUsers([]);
    setSelectedUser(null);
    setDirectMessages([]);
    setDirectText("");
    setMode("login");
    setError("");
    setSuccess("");
    setDashboardMessage("");
    setDashboardError("");
    setUsersError("");
  };

  // =========================
  // MEETING ROOM
  // =========================

  if (currentUser && activeMeeting) {
    const isHost =
      activeMeeting.host_id === currentUser.id;

    return (
      <main
        style={{
          minHeight: "100vh",
          background: "#0b1020",
          color: "#fff",
          padding: 20,
          boxSizing: "border-box",
        }}
      >
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 15,
            marginBottom: 22,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <Video size={28} color="#60a5fa" />

            <h2 style={{ margin: 0 }}>
              Meeting
              <span style={{ color: "#60a5fa" }}>Zone</span>
            </h2>
          </div>

          <div style={{ textAlign: "right" }}>
            <strong>{activeMeeting.title}</strong>

            <p
              style={{
                margin: "5px 0",
                color: "#94a3b8",
              }}
            >
              Code: {activeMeeting.meeting_code}
            </p>
          </div>
        </header>

        <p
          style={{
            color: "#94a3b8",
            margin: "0 0 15px",
          }}
        >
          {connectionStatus} · {remoteParticipants.length + 1} participant(s)
        </p>

        {roomError && (
          <div
            role="alert"
            style={{
              background: "#7f1d1d",
              padding: 12,
              borderRadius: 8,
              marginBottom: 15,
            }}
          >
            {roomError}
          </div>
        )}

        <section
          style={{
            display: "grid",
            gridTemplateColumns:
              "minmax(0, 1fr) minmax(280px, 340px)",
            gap: 18,
            alignItems: "start",
          }}
        >
          <div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "repeat(auto-fit, minmax(240px, 1fr))",
                gap: 15,
              }}
            >
              <div style={styles.videoTile}>
                {localStream && cameraOn ? (
                  <video
                    ref={videoRef}
                    autoPlay
                    muted
                    playsInline
                    style={styles.video}
                  />
                ) : (
                  <div
                    style={{
                      textAlign: "center",
                      color: "#94a3b8",
                    }}
                  >
                    <Avatar
                      picture={currentUser.profile_picture}
                      name={currentUser.full_name}
                      size={100}
                    />

                    <p>{currentUser.full_name}</p>
                    <p>Camera is off</p>
                  </div>
                )}

                <span style={styles.videoLabel}>
                  {currentUser.full_name} (You)
                </span>
              </div>

              {remoteParticipants.map((participant) => (
                <RemoteVideo
                  key={participant.userId}
                  stream={participant.stream}
                  label={
                    participantUsers.find(
                      (u) => u.id === participant.userId
                    )?.full_name ||
                    `Participant ${participant.userId}`
                  }
                />
              ))}
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
                marginTop: 22,
              }}
            >
              <button
                onClick={toggleMic}
                disabled={!localStream}
                style={{
                  ...styles.action,
                  background: micOn ? "#263449" : "#dc2626",
                }}
              >
                {micOn ? <Mic /> : <MicOff />}
                {micOn ? "Mic On" : "Mic Off"}
              </button>

              <button
                onClick={toggleCamera}
                disabled={!localStream}
                style={{
                  ...styles.action,
                  background: cameraOn ? "#263449" : "#dc2626",
                }}
              >
                {cameraOn ? <Video /> : <VideoOff />}
                {cameraOn ? "Camera On" : "Camera Off"}
              </button>

              <button
                disabled
                title="Screen sharing will be added later"
                style={{
                  ...styles.action,
                  background: "#263449",
                  color: "#94a3b8",
                  cursor: "not-allowed",
                }}
              >
                <Monitor /> Share Screen
              </button>

              <button
                onClick={leaveMeeting}
                style={{
                  ...styles.action,
                  background: "#dc2626",
                }}
              >
                <PhoneOff /> Leave Meeting
              </button>
            </div>

            {/* MEETING GROUP CHAT */}
            <div
              style={{
                ...styles.panel,
                marginTop: 22,
              }}
            >
              <h3
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                }}
              >
                <MessageCircle size={21} />
                Meeting Chat
              </h3>

              <div
                style={{
                  height: 300,
                  overflowY: "auto",
                  background: "#0f172a",
                  borderRadius: 10,
                  padding: 12,
                  marginBottom: 12,
                }}
              >
                {chatLoading && (
                  <p style={{ color: "#94a3b8" }}>
                    Loading messages...
                  </p>
                )}

                {!chatLoading && chatMessages.length === 0 && (
                  <p
                    style={{
                      color: "#94a3b8",
                      textAlign: "center",
                    }}
                  >
                    No messages yet. Start the conversation.
                  </p>
                )}

                {chatMessages.map((message) => {
                  const senderId = Number(
                    message.sender_id ?? message.user_id
                  );

                  return (
                    <div
                      key={message.id}
                      style={{
                        display: "flex",
                        gap: 9,
                        alignItems: "flex-start",
                        marginBottom: 15,
                      }}
                    >
                      <Avatar
                        picture={message.profile_picture}
                        name={
                          message.sender_name ||
                          message.full_name
                        }
                        size={34}
                      />

                      <div
                        style={{
                          flex: 1,
                          minWidth: 0,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 8,
                            flexWrap: "wrap",
                          }}
                        >
                          <strong style={{ fontSize: 13 }}>
                            {senderId === currentUser.id
                              ? "You"
                              : message.sender_name ||
                                message.full_name ||
                                `User ${senderId}`}
                          </strong>

                          {isHost && (
                            <button
                              onClick={() =>
                                deleteMeetingMessage(message.id)
                              }
                              title="Delete message"
                              style={{
                                background: "transparent",
                                border: 0,
                                color: "#f87171",
                                cursor: "pointer",
                              }}
                            >
                              <Trash2 size={15} />
                            </button>
                          )}
                        </div>

                        <p
                          style={{
                            margin: "5px 0",
                            color: "#e2e8f0",
                            overflowWrap: "anywhere",
                          }}
                        >
                          {message.message}
                        </p>

                        {message.created_at && (
                          <small style={{ color: "#64748b" }}>
                            {new Date(
                              message.created_at
                            ).toLocaleTimeString()}
                          </small>
                        )}
                      </div>
                    </div>
                  );
                })}

                <div ref={chatEndRef} />
              </div>

              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  marginBottom: 12,
                }}
              >
                {quickMessages.map((message) => (
                  <button
                    key={message}
                    type="button"
                    onClick={() => sendMeetingMessage(message)}
                    style={{
                      border: "1px solid #475569",
                      borderRadius: 20,
                      padding: "8px 12px",
                      background: "#263449",
                      color: "#e2e8f0",
                      cursor: "pointer",
                      fontSize: 13,
                    }}
                  >
                    {message}
                  </button>
                ))}
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  sendMeetingMessage();
                }}
                style={{
                  display: "flex",
                  gap: 8,
                }}
              >
                <input
                  value={chatText}
                  onChange={(e) => setChatText(e.target.value)}
                  placeholder="Write a custom message..."
                  style={styles.field}
                  maxLength={2000}
                />

                <button type="submit" style={styles.action}>
                  <Send size={18} />
                </button>
              </form>
            </div>
          </div>

          {/* PARTICIPANTS AND PRIVATE CHAT */}
          <aside style={styles.panel}>
            <h3
              style={{
                display: "flex",
                gap: 10,
                alignItems: "center",
              }}
            >
              <Users size={21} />
              Participants
            </h3>

            <div
              style={{
                background: "#263449",
                padding: 12,
                borderRadius: 9,
                marginTop: 15,
                display: "flex",
                gap: 10,
                alignItems: "center",
              }}
            >
              <Avatar
                picture={currentUser.profile_picture}
                name={currentUser.full_name}
                size={35}
              />

              <div>
                <strong>{currentUser.full_name} (You)</strong>

                <p
                  style={{
                    color: "#94a3b8",
                    margin: "4px 0 0",
                    fontSize: 12,
                  }}
                >
                  {activeMeeting.role}
                </p>
              </div>
            </div>

            {remoteParticipants.map((participant) => {
              const person = participantUsers.find(
                (u) => u.id === participant.userId
              );

              return (
                <div
                  key={participant.userId}
                  style={{
                    background: "#263449",
                    padding: 12,
                    borderRadius: 9,
                    marginTop: 10,
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                  }}
                >
                  <Avatar
                    picture={person?.profile_picture}
                    name={person?.full_name}
                    size={35}
                  />

                  <div>
                    <strong>
                      {person?.full_name ||
                        `Participant ${participant.userId}`}
                    </strong>

                    <p
                      style={{
                        color: "#94a3b8",
                        margin: "4px 0 0",
                        fontSize: 12,
                      }}
                    >
                      Connected
                    </p>
                  </div>
                </div>
              );
            })}

            {remoteParticipants.length === 0 && (
              <p
                style={{
                  color: "#94a3b8",
                  fontSize: 13,
                  marginTop: 20,
                }}
              >
                Waiting for another participant to join...
              </p>
            )}

            {/* PRIVATE CHAT INSIDE MEETING */}
            <div
              style={{
                marginTop: 24,
                borderTop: "1px solid #334155",
                paddingTop: 18,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <h3
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                    margin: 0,
                  }}
                >
                  <MessageCircle size={20} />
                  Private Chat
                </h3>

                <button
                  type="button"
                  onClick={refreshUsers}
                  title="Refresh users"
                  style={{
                    ...styles.action,
                    padding: 8,
                    background: "#334155",
                  }}
                >
                  <RefreshCw size={16} />
                </button>
              </div>

              <p
                style={{
                  color: "#94a3b8",
                  fontSize: 11,
                  margin: "8px 0",
                }}
              >
                Private chat: {privateSocketStatus}
              </p>

              <select
                value={selectedUser?.id ?? ""}
                onChange={(e) => {
                  const user = allUsers.find(
                    (item) =>
                      item.id === Number(e.target.value)
                  );

                  setSelectedUser(user || null);
                  setDirectMessages([]);
                  setDirectText("");
                }}
                style={{
                  ...styles.field,
                  marginTop: 10,
                }}
              >
                <option value="">Select a user</option>

                {allUsers.map((user) => (
                  <option
                    key={user.id}
                    value={user.id}
                  >
                    {user.full_name}
                  </option>
                ))}
              </select>

              {usersLoading && (
                <p style={{ color: "#94a3b8", fontSize: 12 }}>
                  Loading users...
                </p>
              )}

              {usersError && (
                <p style={{ color: "#f87171", fontSize: 12 }}>
                  {usersError}
                </p>
              )}

              {!usersLoading && allUsers.length === 0 && (
                <p style={{ color: "#94a3b8", fontSize: 12 }}>
                  No other users found. Create another account and refresh.
                </p>
              )}

              {selectedUser ? (
                <>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 9,
                      marginTop: 12,
                      paddingBottom: 10,
                      borderBottom: "1px solid #334155",
                    }}
                  >
                    <Avatar
                      picture={selectedUser.profile_picture}
                      name={selectedUser.full_name}
                      size={34}
                    />

                    <strong style={{ fontSize: 14 }}>
                      {selectedUser.full_name}
                    </strong>

                    <button
                      type="button"
                      onClick={() => {
                        setSelectedUser(null);
                        setDirectMessages([]);
                        setDirectText("");
                      }}
                      style={{
                        marginLeft: "auto",
                        background: "transparent",
                        border: 0,
                        color: "#94a3b8",
                        cursor: "pointer",
                      }}
                    >
                      <X size={17} />
                    </button>
                  </div>

                  <div
                    style={{
                      height: 250,
                      overflowY: "auto",
                      background: "#0f172a",
                      borderRadius: 9,
                      padding: 10,
                      marginTop: 10,
                      marginBottom: 10,
                    }}
                  >
                    {directLoading && (
                      <p
                        style={{
                          color: "#94a3b8",
                          fontSize: 13,
                        }}
                      >
                        Loading conversation...
                      </p>
                    )}

                    {!directLoading &&
                      directMessages.length === 0 && (
                        <p
                          style={{
                            color: "#94a3b8",
                            fontSize: 13,
                            textAlign: "center",
                          }}
                        >
                          No messages yet. Say hello!
                        </p>
                      )}

                    {directMessages.map((message) => {
                      const mine =
                        message.sender_id === currentUser.id;

                      return (
                        <div
                          key={message.id}
                          style={{
                            display: "flex",
                            justifyContent: mine
                              ? "flex-end"
                              : "flex-start",
                            marginBottom: 9,
                          }}
                        >
                          <div
                            style={{
                              maxWidth: "90%",
                              padding: "8px 10px",
                              borderRadius: 10,
                              background: mine
                                ? "#2563eb"
                                : "#334155",
                              color: "#fff",
                              overflowWrap: "anywhere",
                            }}
                          >
                            <p
                              style={{
                                margin: 0,
                                fontSize: 13,
                              }}
                            >
                              {message.message}
                            </p>

                            {message.created_at && (
                              <small
                                style={{
                                  opacity: 0.7,
                                  fontSize: 10,
                                }}
                              >
                                {new Date(
                                  message.created_at
                                ).toLocaleTimeString()}
                              </small>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    <div ref={directEndRef} />
                  </div>

                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      sendDirectMessage();
                    }}
                    style={{
                      display: "flex",
                      gap: 7,
                    }}
                  >
                    <input
                      value={directText}
                      onChange={(e) =>
                        setDirectText(e.target.value)
                      }
                      placeholder="Private message..."
                      style={{
                        ...styles.field,
                        minWidth: 0,
                        padding: 9,
                      }}
                      maxLength={2000}
                    />

                    <button
                      type="submit"
                      style={{
                        ...styles.action,
                        padding: "9px 12px",
                      }}
                      disabled={!directText.trim() || sendingDirect}
                    >
                      <Send size={17} />
                    </button>
                  </form>
                </>
              ) : (
                <p
                  style={{
                    color: "#94a3b8",
                    fontSize: 13,
                    marginTop: 12,
                  }}
                >
                  Select a user to start a private conversation.
                </p>
              )}
            </div>
          </aside>
        </section>
      </main>
    );
  }

  // =========================
  // DASHBOARD
  // =========================

  if (currentUser) {
    return (
      <main className="dashboard-page">
        <nav className="navbar">
          <a className="brand" href="#">
            <span className="brand-icon">
              <Video size={23} />
            </span>

            <span>
              Meeting<span className="brand-blue">Zone</span>
            </span>
          </a>

          <div className="dashboard-nav">
            <Avatar
              picture={currentUser.profile_picture}
              name={currentUser.full_name}
              size={38}
            />

            <span>{currentUser.full_name}</span>

            <button
              className="logout-btn"
              onClick={logout}
            >
              <LogOut size={17} />
              Logout
            </button>
          </div>
        </nav>

        <section className="dashboard-content">
          <div className="dashboard-welcome">
            <div>
              <p className="dashboard-eyebrow">
                YOUR MEETING WORKSPACE
              </p>

              <h1>
                Welcome, <span>{currentUser.full_name}!</span>
              </h1>

              <p>
                Connect, collaborate and learn without boundaries.
              </p>
            </div>

            <div className="welcome-icon">
              <Video size={36} />
            </div>
          </div>

          {dashboardMessage && (
            <p role="status" style={{ color: "#16a34a" }}>
              {dashboardMessage}
            </p>
          )}

          {dashboardError && (
            <p role="alert" style={{ color: "#dc2626" }}>
              {dashboardError}
            </p>
          )}

          <div className="dashboard-grid">
            <div className="dashboard-card">
              <div className="dashboard-card-icon blue">
                <Plus size={24} />
              </div>

              <h2>Create a Meeting</h2>

              <p>
                Start a new meeting and invite other participants.
              </p>

              <button
                className="dashboard-button"
                onClick={createMeeting}
                disabled={meetingLoading}
              >
                {meetingLoading
                  ? "Please wait..."
                  : "Create Meeting"}

                {!meetingLoading && <ArrowRight size={17} />}
              </button>
            </div>

            <div className="dashboard-card">
              <div className="dashboard-card-icon cyan">
                <Users size={24} />
              </div>

              <h2>Join a Meeting</h2>

              <p>
                Enter a meeting code to join another person's meeting.
              </p>

              <button
                className="dashboard-button secondary"
                onClick={() => {
                  setShowJoin(!showJoin);
                  setDashboardError("");
                  setDashboardMessage("");
                }}
              >
                Join Meeting <ArrowRight size={17} />
              </button>

              {showJoin && (
                <div className="join-box">
                  <input
                    value={meetingCode}
                    onChange={(e) =>
                      setMeetingCode(e.target.value)
                    }
                    placeholder="Enter meeting code"
                  />

                  <button
                    onClick={joinMeeting}
                    disabled={meetingLoading}
                  >
                    {meetingLoading
                      ? "Joining..."
                      : "Continue"}
                  </button>
                </div>
              )}
            </div>

            <div className="dashboard-card">
              <div className="dashboard-card-icon purple">
                <User size={24} />
              </div>

              <h2>My Profile</h2>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 10,
                  padding: "12px 0",
                }}
              >
                <Avatar
                  picture={currentUser.profile_picture}
                  name={currentUser.full_name}
                  size={90}
                />

                <strong>{currentUser.full_name}</strong>
                <small>{currentUser.email}</small>

                <input
                  ref={profileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];

                    if (file) {
                      uploadProfilePicture(file);
                    }

                    e.currentTarget.value = "";
                  }}
                />

                <button
                  className="dashboard-button"
                  onClick={() =>
                    profileInputRef.current?.click()
                  }
                  disabled={profileLoading}
                >
                  <ImagePlus size={17} />

                  {profileLoading
                    ? "Uploading..."
                    : "Upload Picture"}
                </button>

                {currentUser.profile_picture && (
                  <button
                    onClick={removeProfilePicture}
                    disabled={profileLoading}
                    style={{
                      ...styles.action,
                      background: "#991b1b",
                    }}
                  >
                    <Trash2 size={16} />
                    Remove Picture
                  </button>
                )}

                {profileMessage && (
                  <small
                    style={{
                      color: "#16a34a",
                      textAlign: "center",
                    }}
                  >
                    {profileMessage}
                  </small>
                )}

                <small style={{ color: "#94a3b8" }}>
                  JPG, PNG or WebP · Maximum 2 MB
                </small>
              </div>
            </div>
          </div>

          {/* PRIVATE MESSAGES */}
          <section className="recent-section">
            <div className="recent-heading">
              <div>
                <h2>Private Messages</h2>

                <p>
                  Select a user to start a one-to-one conversation.
                </p>
              </div>

              <MessageCircle size={23} />
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 10,
                marginTop: 15,
              }}
            >
              <small style={{ color: "#94a3b8" }}>
                Private chat: {privateSocketStatus}
              </small>

              <button
                type="button"
                onClick={refreshUsers}
                style={{
                  ...styles.action,
                  padding: "9px 12px",
                }}
              >
                <RefreshCw size={16} />
                Refresh Users
              </button>
            </div>

            {usersError && (
              <p
                role="alert"
                style={{
                  color: "#f87171",
                  marginTop: 10,
                }}
              >
                {usersError}
              </p>
            )}

            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "minmax(150px, 0.8fr) minmax(250px, 1.5fr)",
                gap: 15,
                marginTop: 18,
              }}
            >
              <div
                style={{
                  background: "#172033",
                  borderRadius: 12,
                  padding: 12,
                  maxHeight: 420,
                  overflowY: "auto",
                }}
              >
                <h3
                  style={{
                    color: "#fff",
                    marginTop: 5,
                  }}
                >
                  Users
                </h3>

                {usersLoading && (
                  <p style={{ color: "#94a3b8", fontSize: 13 }}>
                    Loading users...
                  </p>
                )}

                {!usersLoading && allUsers.length === 0 && (
                  <p
                    style={{
                      color: "#94a3b8",
                      fontSize: 13,
                    }}
                  >
                    No other users found yet. Create another account and refresh.
                  </p>
                )}

                {allUsers.map((person) => (
                  <button
                    key={person.id}
                    onClick={() => {
                      setSelectedUser(person);
                      setDirectMessages([]);
                      setDirectText("");
                      setDashboardError("");
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 9,
                      width: "100%",
                      padding: 10,
                      marginBottom: 7,
                      border: 0,
                      borderRadius: 9,
                      cursor: "pointer",
                      color: "#fff",
                      textAlign: "left",
                      background:
                        selectedUser?.id === person.id
                          ? "#2563eb"
                          : "#263449",
                    }}
                  >
                    <Avatar
                      picture={person.profile_picture}
                      name={person.full_name}
                      size={34}
                    />

                    <span>{person.full_name}</span>
                  </button>
                ))}
              </div>

              <div
                style={{
                  background: "#172033",
                  borderRadius: 12,
                  padding: 14,
                  minHeight: 350,
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                {selectedUser ? (
                  <>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        borderBottom: "1px solid #334155",
                        paddingBottom: 12,
                      }}
                    >
                      <Avatar
                        picture={selectedUser.profile_picture}
                        name={selectedUser.full_name}
                        size={38}
                      />

                      <strong>{selectedUser.full_name}</strong>

                      <button
                        onClick={() =>
                          setSelectedUser(null)
                        }
                        style={{
                          marginLeft: "auto",
                          background: "transparent",
                          border: 0,
                          color: "#94a3b8",
                          cursor: "pointer",
                        }}
                      >
                        <X size={19} />
                      </button>
                    </div>

                    <div
                      style={{
                        flex: 1,
                        minHeight: 230,
                        maxHeight: 300,
                        overflowY: "auto",
                        padding: "12px 0",
                      }}
                    >
                      {directLoading && (
                        <p style={{ color: "#94a3b8" }}>
                          Loading conversation...
                        </p>
                      )}

                      {!directLoading &&
                        directMessages.length === 0 && (
                          <p
                            style={{
                              color: "#94a3b8",
                              textAlign: "center",
                            }}
                          >
                            No messages yet. Say hello!
                          </p>
                        )}

                      {directMessages.map((message) => {
                        const mine =
                          message.sender_id === currentUser.id;

                        return (
                          <div
                            key={message.id}
                            style={{
                              display: "flex",
                              justifyContent: mine
                                ? "flex-end"
                                : "flex-start",
                              marginBottom: 10,
                            }}
                          >
                            <div
                              style={{
                                maxWidth: "80%",
                                padding: "9px 12px",
                                borderRadius: 12,
                                background: mine
                                  ? "#2563eb"
                                  : "#334155",
                                color: "#fff",
                                overflowWrap: "anywhere",
                              }}
                            >
                              <p style={{ margin: 0 }}>
                                {message.message}
                              </p>

                              {message.created_at && (
                                <small style={{ opacity: 0.7 }}>
                                  {new Date(
                                    message.created_at
                                  ).toLocaleTimeString()}
                                </small>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      <div ref={directEndRef} />
                    </div>

                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        sendDirectMessage();
                      }}
                      style={{
                        display: "flex",
                        gap: 8,
                      }}
                    >
                      <input
                        value={directText}
                        onChange={(e) =>
                          setDirectText(e.target.value)
                        }
                        placeholder="Write a private message..."
                        style={styles.field}
                        maxLength={2000}
                      />

                      <button
                        type="submit"
                        style={styles.action}
                        disabled={!directText.trim() || sendingDirect}
                      >
                        <Send size={18} />
                      </button>
                    </form>
                  </>
                ) : (
                  <div
                    style={{
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "center",
                      alignItems: "center",
                      color: "#94a3b8",
                      textAlign: "center",
                    }}
                  >
                    <MessageCircle size={42} />

                    <p>
                      Select a user to open private chat.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* RECENT MEETINGS */}
          <section className="recent-section">
            <div className="recent-heading">
              <div>
                <h2>Recent Meetings</h2>

                <p>
                  Your recently created and joined meetings.
                </p>
              </div>

              <CalendarDays size={23} />
            </div>

            {meetings.length === 0 ? (
              <div className="empty-meetings">
                <Video size={32} />

                <h3>No meetings yet</h3>

                <p>
                  Create your first meeting to get started.
                </p>
              </div>
            ) : (
              meetings.map((meeting) => (
                <div
                  className="meeting-item"
                  key={meeting.id}
                >
                  <div className="meeting-item-icon">
                    <Video size={20} />
                  </div>

                  <div className="meeting-info">
                    <strong>{meeting.title}</strong>

                    <small>
                      {new Date(
                        meeting.created_at
                      ).toLocaleString()}

                      {" • "}

                      {meeting.role}
                    </small>
                  </div>

                  <button
                    className="copy-code"
                    onClick={() => {
                      navigator.clipboard
                        .writeText(meeting.meeting_code)
                        .then(() =>
                          alert("Meeting code copied!")
                        )
                        .catch(() =>
                          alert("Unable to copy meeting code.")
                        );
                    }}
                  >
                    <Copy size={15} />
                    {meeting.meeting_code}
                  </button>
                </div>
              ))
            )}
          </section>

          <p className="dashboard-footer">
            © 2026 Meeting Zone. Communication without limits.
          </p>
        </section>
      </main>
    );
  }

  // =========================
  // SIGNUP / LOGIN
  // =========================

  return (
    <main className="page">
      <nav className="navbar">
        <a className="brand" href="#">
          <span className="brand-icon">
            <Video size={23} />
          </span>

          <span>
            Meeting<span className="brand-blue">Zone</span>
          </span>
        </a>

        <div className="nav-right">
          <span className="online-dot" />
          Global communication platform
        </div>
      </nav>

      <section className="hero">
        <div className="hero-content">
          <div className="eyebrow">
            <Globe2 size={15} />
            CONNECT WITHOUT BOUNDARIES
          </div>

          <h1>
            One world.
            <br />
            <span>Every language.</span>
          </h1>

          <p className="hero-description">
            Meet, communicate and collaborate with people around the world.
            Your language should never be a barrier.
          </p>

          <div className="features">
            <div>
              <Languages />
              <span>AI-powered translation</span>
            </div>

            <div>
              <Globe2 />
              <span>Connect from anywhere</span>
            </div>

            <div>
              <ShieldCheck />
              <span>Secure meeting experience</span>
            </div>
          </div>

          <div className="hero-footer">
            <span className="footer-line" />
            Communication without limits.
          </div>
        </div>

        <div className="form-side">
          <div className="form-card">
            <div className="form-heading">
              <div className="form-icon">
                <Video size={22} />
              </div>

              <p className="welcome">
                WELCOME TO MEETING ZONE
              </p>

              <h2>
                {mode === "signup"
                  ? "Create your account"
                  : "Welcome back"}
              </h2>

              <p className="form-subtitle">
                {mode === "signup"
                  ? "Join a world where everyone speaks your language."
                  : "Sign in to continue to your meetings."}
              </p>
            </div>

            <div className="tabs">
              <button
                type="button"
                className={
                  mode === "signup"
                    ? "tab active"
                    : "tab"
                }
                onClick={() => {
                  setMode("signup");
                  setError("");
                  setSuccess("");
                }}
              >
                Create account
              </button>

              <button
                type="button"
                className={
                  mode === "login"
                    ? "tab active"
                    : "tab"
                }
                onClick={() => {
                  setMode("login");
                  setError("");
                  setSuccess("");
                }}
              >
                Sign in
              </button>
            </div>

            <form onSubmit={handleAuth}>
              {mode === "signup" && (
                <label>
                  Full name

                  <input
                    type="text"
                    placeholder="Enter your full name"
                    value={fullName}
                    onChange={(e) =>
                      setFullName(e.target.value)
                    }
                    minLength={2}
                    maxLength={100}
                    required
                  />
                </label>
              )}

              <label>
                Email address

                <input
                  type="email"
                  placeholder="name@example.com"
                  value={email}
                  onChange={(e) =>
                    setEmail(e.target.value)
                  }
                  required
                />
              </label>

              <label>
                Password

                <div className="password-wrap">
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) =>
                      setPassword(e.target.value)
                    }
                    minLength={8}
                    maxLength={128}
                    required
                  />

                  <button
                    type="button"
                    className="eye"
                    onClick={() =>
                      setShowPassword(!showPassword)
                    }
                  >
                    {showPassword
                      ? <EyeOff size={18} />
                      : <Eye size={18} />}
                  </button>
                </div>
              </label>

              {mode === "signup" && (
                <label>
                  Preferred language

                  <select
                    value={language}
                    onChange={(e) =>
                      setLanguage(e.target.value)
                    }
                  >
                    {[
                      "English",
                      "Urdu",
                      "Sindhi",
                      "Punjabi",
                      "Arabic",
                      "Spanish",
                      "French",
                      "Chinese",
                    ].map((lang) => (
                      <option key={lang}>
                        {lang}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {mode === "login" && (
                <div className="forgot">
                  <a href="#forgot">
                    Forgot password?
                  </a>
                </div>
              )}

              {error && (
                <p role="alert" style={{ color: "#dc2626" }}>
                  {error}
                </p>
              )}

              {success && (
                <p role="status" style={{ color: "#16a34a" }}>
                  {success}
                </p>
              )}

              <button
                className="submit-btn"
                type="submit"
                disabled={loading}
              >
                {loading
                  ? "Please wait..."
                  : mode === "signup"
                    ? "Create account"
                    : "Sign in"}

                {!loading && <ArrowRight size={18} />}
              </button>
            </form>

            <div className="terms">
              By continuing, you agree to our{" "}
              <a href="#terms">Terms of Service</a>
              {" "}and{" "}
              <a href="#privacy">Privacy Policy</a>.
            </div>
          </div>

          <p className="copyright">
            © 2026 Meeting Zone. All rights reserved.
          </p>
        </div>
      </section>
    </main>
  );
}