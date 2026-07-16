"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { normalizeRoomId, isValidRoomId } from "@ghostchat/shared";
import { createRoom, getRoomStatus } from "@/lib/api";
import { RelayStatus } from "./RelayStatus";
import { TerminalFrame } from "./TerminalFrame";

export function Landing() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onCreate() {
    setBusy(true);
    setError(null);
    try {
      const { roomId } = await createRoom();
      router.push(`/r/${roomId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
      setBusy(false);
    }
  }

  async function onJoin(e: React.FormEvent) {
    e.preventDefault();
    const roomId = normalizeRoomId(code);
    if (!isValidRoomId(roomId)) {
      setError("Invalid code (6 chars, no 0/O/1/I)");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const status = await getRoomStatus(roomId);
      if (status.status === "not_found") {
        setError("Room not found — it may have vanished");
        setBusy(false);
        return;
      }
      if (status.status === "full" || (status.status === "ok" && status.full)) {
        setError("Room is full (max 2)");
        setBusy(false);
        return;
      }
      router.push(`/r/${roomId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Join failed");
      setBusy(false);
    }
  }

  return (
    <TerminalFrame
      title="ghostchat"
      footer={
        <p className="leading-relaxed">
          Zero-knowledge · E2EE · Ephemeral
        </p>
      }
    >
      <div className="flex flex-col gap-5 sm:gap-8">
        <div>
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-ghost-green sm:text-sm">$ ghostchat</p>
            <RelayStatus />
          </div>
          <h1 className="text-[1.35rem] font-semibold leading-tight tracking-tight text-white sm:text-3xl">
            Anonymous.
            <br className="sm:hidden" /> Encrypted. Gone.
          </h1>
          <p className="mt-2 max-w-md text-xs leading-relaxed text-ghost-dim sm:mt-3 sm:text-sm">
            1:1 chat in seconds. No accounts, no history. Room dies when you
            leave.
          </p>
        </div>

        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            disabled={busy}
            onClick={onCreate}
            className="min-h-12 w-full touch-manipulation bg-ghost-green px-5 py-3.5 text-sm font-semibold text-black transition-colors active:bg-ghost-green/80 disabled:opacity-50 sm:min-h-11 sm:w-auto sm:self-start sm:py-2.5"
          >
            {busy ? "…" : "Create Room"}
          </button>

          <div className="flex items-center gap-3 py-0.5 text-[10px] uppercase tracking-wider text-ghost-dim">
            <span className="h-px flex-1 bg-ghost-border" />
            or join
            <span className="h-px flex-1 bg-ghost-border" />
          </div>

          <form onSubmit={onJoin} className="flex flex-col gap-2">
            <label className="sr-only" htmlFor="room-code">
              Room code
            </label>
            <input
              id="room-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="6-CHAR CODE"
              maxLength={6}
              inputMode="text"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="off"
              enterKeyHint="go"
              className="min-h-12 w-full touch-manipulation border border-ghost-border bg-ghost-bg px-3 py-3 text-center text-base tracking-[0.35em] text-ghost-green placeholder:tracking-normal placeholder:text-ghost-dim/55 focus:border-ghost-green sm:text-left sm:tracking-[0.2em] sm:text-sm"
            />
            <button
              type="submit"
              disabled={busy || code.length < 6}
              className="min-h-12 w-full touch-manipulation border border-ghost-green px-5 py-3 text-sm font-medium text-ghost-green transition-colors active:bg-ghost-green/10 disabled:opacity-40 sm:min-h-11"
            >
              Join
            </button>
          </form>

          {error ? (
            <p className="text-sm leading-snug text-ghost-red" role="alert">
              ! {error}
            </p>
          ) : null}
        </div>

        <p className="text-[11px] leading-relaxed text-ghost-dim sm:text-xs">
          Tip: create a room, then let your peer{" "}
          <strong className="text-ghost-green">scan the QR</strong> with their
          camera.
        </p>

        <details className="border border-ghost-border/60 p-3 text-xs text-ghost-dim">
          <summary className="min-h-11 cursor-pointer touch-manipulation list-none py-1 text-ghost-dim [-webkit-tap-highlight-color:transparent] hover:text-white">
            What is protected / what is not
          </summary>
          <ul className="mt-2 list-disc space-y-1.5 pl-4 leading-relaxed">
            <li>
              Protected: message contents (E2EE), no permanent server storage,
              no accounts.
            </li>
            <li>
              Not protected: compromised devices, sharing the room code with the
              wrong person, endpoint malware.
            </li>
            <li>
              The room code is the access credential — share it only over a
              trusted channel.
            </li>
            <li>
              After connect, compare the{" "}
              <strong className="text-white">safety number</strong> with your
              peer.
            </li>
          </ul>
        </details>
      </div>
    </TerminalFrame>
  );
}
