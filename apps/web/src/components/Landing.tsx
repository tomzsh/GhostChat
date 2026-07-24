"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  normalizeRoomId,
  isValidRoomId,
  LIMITS,
  clampMaxParticipants,
} from "@ghostchat/shared";
import { createRoom, getRoomStatus } from "@/lib/api";
import { RelayStatus } from "./RelayStatus";
import { TerminalFrame } from "./TerminalFrame";

const SIZE_PRESETS = [2, 3, 5, 8, 12, 20] as const;

export function Landing() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [maxParticipants, setMaxParticipants] = useState<number>(
    LIMITS.defaultMaxParticipants
  );

  async function onCreate() {
    setBusy(true);
    setError(null);
    try {
      const max = clampMaxParticipants(maxParticipants);
      const { roomId } = await createRoom({ maxParticipants: max });
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
        const cap =
          status.status === "ok"
            ? status.maxParticipants
            : status.maxParticipants;
        setError(
          cap
            ? `Room is full (max ${cap})`
            : "Room is full"
        );
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
          Zero-knowledge · E2EE · Ephemeral · Groups
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
            1:1 or small group chat. No accounts, no history. Creator sets max
            members.
          </p>
        </div>

        <div className="flex flex-col gap-2.5">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="max-users"
              className="text-[11px] font-medium text-ghost-green/90 sm:text-xs"
            >
              Max members (creator limit)
            </label>
            <div className="flex flex-wrap gap-1.5">
              {SIZE_PRESETS.filter((n) => n <= LIMITS.maxParticipantsCap).map(
                (n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setMaxParticipants(n)}
                    className={`chip min-w-[2.75rem] ${
                      maxParticipants === n ? "chip--active" : ""
                    }`}
                  >
                    {n}
                    {n === 2 ? " · 1:1" : ""}
                  </button>
                )
              )}
            </div>
            <p className="text-[10px] text-ghost-dim/80 sm:text-[11px]">
              Room holds up to{" "}
              <strong className="text-ghost-green">{maxParticipants}</strong>{" "}
              people (including you). Cap {LIMITS.maxParticipantsCap}.
            </p>
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={onCreate}
            className="min-h-12 w-full touch-manipulation bg-ghost-green px-5 py-3.5 text-sm font-semibold text-black transition-colors active:bg-ghost-green/80 disabled:opacity-50 sm:min-h-11 sm:w-auto sm:self-start sm:py-2.5"
          >
            {busy ? "…" : `Create Room · max ${maxParticipants}`}
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
          Tip: create a room, share the code or{" "}
          <strong className="text-ghost-green">QR</strong>. Members join via{" "}
          <strong className="text-ghost-green">MLS</strong> (E2EE).
        </p>

        <details className="border border-ghost-border/60 p-3 text-xs text-ghost-dim">
          <summary className="min-h-11 cursor-pointer touch-manipulation list-none py-1 text-ghost-dim hover:text-white">
            What is protected / what is not
          </summary>
          <ul className="mt-2 list-disc space-y-1.5 pl-4 leading-relaxed">
            <li>
              Protected: message contents (MLS group encryption), no permanent
              server storage, no accounts.
            </li>
            <li>
              Burn modes: after read, 10s, 60s, or <strong className="text-white">when I leave</strong>{" "}
              (no timer — hangus when the sender leaves).
            </li>
            <li>
              When someone leaves, the <strong className="text-white">room code rotates</strong> so
              old links stop working for new joiners.
            </li>
            <li>
              Optional <strong className="text-white">images</strong> (≤1MB
              compressed, E2EE) — no
              server storage.
            </li>
            <li>
              Not protected: compromised devices, sharing the room code with the
              wrong people.
            </li>
            <li>
              Compare the <strong className="text-white">safety number</strong>{" "}
              after connect — all members should match.
            </li>
          </ul>
        </details>
      </div>
    </TerminalFrame>
  );
}
