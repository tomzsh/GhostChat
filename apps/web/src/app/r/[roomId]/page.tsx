import { RoomChat } from "@/components/RoomChat";
import { normalizeRoomId, isValidRoomId } from "@ghostchat/shared";
import { TerminalFrame } from "@/components/TerminalFrame";
import Link from "next/link";

type Props = {
  params: Promise<{ roomId: string }>;
};

export default async function RoomPage({ params }: Props) {
  const { roomId: raw } = await params;
  const roomId = normalizeRoomId(raw);

  if (!isValidRoomId(roomId)) {
    return (
      <TerminalFrame title="ghostchat · error">
        <p className="text-sm text-ghost-red">Invalid room code.</p>
        <Link
          href="/"
          className="mt-4 inline-flex min-h-11 items-center text-sm text-ghost-green underline"
        >
          ← back home
        </Link>
      </TerminalFrame>
    );
  }

  return <RoomChat roomId={roomId} />;
}
