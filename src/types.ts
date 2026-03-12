export interface Message {
  id: string;
  sender: string;
  senderName?: string;
  content: string;
  timestamp: number;
  media?: {
    type: string;
    data: string; // Base64 encrypted
    name: string;
  };
  reactions?: { [emoji: string]: string[] };
}

export type Peer = {
  id: string;
  name?: string;
  stream?: MediaStream;
  isMuted?: boolean;
  isVideoOff?: boolean;
  volume?: number;
}
