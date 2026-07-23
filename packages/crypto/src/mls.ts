/**
 * MLS (RFC 9420) helpers for GhostChat group E2EE via ts-mls.
 * Server never sees private keys or group state — only base64 MLSMessages.
 */
import {
  generateKeyPackage,
  createGroup,
  createCommit,
  joinGroup,
  createApplicationMessage,
  processPrivateMessage,
  getCiphersuiteImpl,
  getCiphersuiteFromName,
  defaultCapabilities,
  defaultLifetime,
  emptyPskIndex,
  encodeMlsMessage,
  decodeMlsMessage,
  zeroOutUint8Array,
  type ClientState,
  type KeyPackage,
  type PrivateKeyPackage,
  type CiphersuiteImpl,
  type MLSMessage,
  type PrivateMessage,
  type Welcome,
} from "ts-mls";
import { sha256 } from "@noble/hashes/sha2";

const CIPHERSUITE_NAME = "MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519" as const;
const textEnc = new TextEncoder();
const textDec = new TextDecoder();

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

let implPromise: Promise<CiphersuiteImpl> | null = null;

function getImpl(): Promise<CiphersuiteImpl> {
  if (!implPromise) {
    implPromise = getCiphersuiteImpl(getCiphersuiteFromName(CIPHERSUITE_NAME));
  }
  return implPromise;
}

export type MlsSession = {
  identity: string;
  groupId: string;
  publicPackage: KeyPackage;
  privatePackage: PrivateKeyPackage;
  /** Set once we are in the MLS group (creator or after Welcome). */
  state: ClientState | null;
};

function basicCredential(identity: string) {
  return {
    credentialType: "basic" as const,
    identity: textEnc.encode(identity),
  };
}

function encodeWire(msg: MLSMessage): string {
  return toBase64(encodeMlsMessage(msg));
}

function decodeWire(b64: string): MLSMessage {
  const bytes = fromBase64(b64);
  const decoded = decodeMlsMessage(bytes, 0);
  if (!decoded) throw new Error("Invalid MLS message encoding");
  return decoded[0]!;
}

function privateMessageFromCommit(commit: MLSMessage): PrivateMessage {
  if (commit.wireformat !== "mls_private_message") {
    throw new Error(`Expected private commit, got ${commit.wireformat}`);
  }
  return commit.privateMessage;
}

/**
 * Create a fresh MLS key package for this identity (display id) and room.
 * Does not create a group yet.
 */
export async function createMlsSession(
  identity: string,
  groupId: string
): Promise<MlsSession> {
  const impl = await getImpl();
  const kp = await generateKeyPackage(
    basicCredential(identity),
    defaultCapabilities(),
    defaultLifetime,
    [],
    impl
  );
  return {
    identity,
    groupId,
    publicPackage: kp.publicPackage,
    privatePackage: kp.privatePackage,
    state: null,
  };
}

/** First occupant: create epoch-0 group. */
export async function bootstrapGroup(session: MlsSession): Promise<MlsSession> {
  const impl = await getImpl();
  const state = await createGroup(
    textEnc.encode(session.groupId),
    session.publicPackage,
    session.privatePackage,
    [],
    impl
  );
  return { ...session, state };
}

/** Export key package as base64 MLSMessage for the wire. */
export function exportKeyPackage(session: MlsSession): string {
  return encodeWire({
    version: "mls10",
    wireformat: "mls_key_package",
    keyPackage: session.publicPackage,
  });
}

function parseKeyPackage(b64: string): KeyPackage {
  const msg = decodeWire(b64);
  if (msg.wireformat !== "mls_key_package") {
    throw new Error("Expected mls_key_package");
  }
  return msg.keyPackage;
}

/**
 * Add a joiner by their key package. Returns Welcome (unicast) + Commit (broadcast).
 * Requires ratchetTreeExtension so joiner needs no out-of-band tree.
 */
export async function addMember(
  session: MlsSession,
  keyPackageB64: string
): Promise<{ session: MlsSession; welcomeB64: string; commitB64: string }> {
  if (!session.state) throw new Error("No MLS group state");
  const impl = await getImpl();
  const keyPackage = parseKeyPackage(keyPackageB64);
  const result = await createCommit(
    { state: session.state, cipherSuite: impl },
    {
      extraProposals: [
        { proposalType: "add", add: { keyPackage } },
      ],
      ratchetTreeExtension: true,
    }
  );
  result.consumed.forEach(zeroOutUint8Array);
  if (!result.welcome) throw new Error("Add commit produced no Welcome");

  const welcomeB64 = encodeWire({
    version: "mls10",
    wireformat: "mls_welcome",
    welcome: result.welcome,
  });
  const commitB64 = encodeWire(result.commit);

  return {
    session: { ...session, state: result.newState },
    welcomeB64,
    commitB64,
  };
}

/** Joiner: process Welcome and enter the group. */
export async function acceptWelcome(
  session: MlsSession,
  welcomeB64: string
): Promise<MlsSession> {
  const impl = await getImpl();
  const msg = decodeWire(welcomeB64);
  if (msg.wireformat !== "mls_welcome") {
    throw new Error("Expected mls_welcome");
  }
  const welcome: Welcome = msg.welcome;
  const state = await joinGroup(
    welcome,
    session.publicPackage,
    session.privatePackage,
    emptyPskIndex,
    impl
  );
  return { ...session, state };
}

/** Process a Commit from another member (epoch advance). */
export async function processCommit(
  session: MlsSession,
  commitB64: string
): Promise<MlsSession> {
  if (!session.state) throw new Error("No MLS group state");
  const impl = await getImpl();
  const msg = decodeWire(commitB64);
  const pm = privateMessageFromCommit(msg);
  const result = await processPrivateMessage(
    session.state,
    pm,
    emptyPskIndex,
    impl
  );
  result.consumed.forEach(zeroOutUint8Array);
  return { ...session, state: result.newState };
}

/**
 * Apply a commit only when it advances our epoch.
 * Joiners already reach the Add epoch via Welcome; the same commit is still
 * broadcast on the wire and fails with "epoch too old" if re-applied — that is
 * expected and must not surface as a UI error.
 */
export async function processCommitIfNeeded(
  session: MlsSession,
  commitB64: string
): Promise<{ session: MlsSession; applied: boolean }> {
  if (!session.state) {
    return { session, applied: false };
  }
  try {
    const next = await processCommit(session, commitB64);
    return { session: next, applied: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Stale / already-applied commits (Welcome path or duplicate broadcast)
    if (
      /epoch too old/i.test(msg) ||
      /too old/i.test(msg) ||
      /already/i.test(msg) ||
      /OperationError/i.test(msg) ||
      /operation failed/i.test(msg)
    ) {
      return { session, applied: false };
    }
    // Unknown failure: do not advance, do not throw (UI must not show join noise).
    // Decrypt will surface real desync later.
    return { session, applied: false };
  }
}

/** Leaf index for a basic-credential identity, or null. */
export function findLeafIndex(
  session: MlsSession,
  identity: string
): number | null {
  if (!session.state) return null;
  const tree = session.state.ratchetTree;
  for (let nodeIndex = 0; nodeIndex < tree.length; nodeIndex++) {
    const node = tree[nodeIndex];
    if (!node || node.nodeType !== "leaf") continue;
    const leaf = node.leaf;
    if (!leaf || leaf.credential.credentialType !== "basic") continue;
    const id = textDec.decode(leaf.credential.identity);
    if (id === identity) {
      // Array form: leaves at even indices; leafIndex = nodeIndex / 2
      return nodeIndex / 2;
    }
  }
  return null;
}

/**
 * Remove a member by display identity. Returns commit to broadcast, or null if not found.
 */
export async function removeMember(
  session: MlsSession,
  identity: string
): Promise<{ session: MlsSession; commitB64: string } | null> {
  if (!session.state) return null;
  if (identity === session.identity) return null;
  const leaf = findLeafIndex(session, identity);
  if (leaf === null) return null;
  const impl = await getImpl();
  const result = await createCommit(
    { state: session.state, cipherSuite: impl },
    {
      extraProposals: [
        { proposalType: "remove", remove: { removed: leaf } },
      ],
    }
  );
  result.consumed.forEach(zeroOutUint8Array);
  return {
    session: { ...session, state: result.newState },
    commitB64: encodeWire(result.commit),
  };
}

/** Encrypt application plaintext → base64 MLS private message. */
export async function encryptApp(
  session: MlsSession,
  plaintext: string
): Promise<{ session: MlsSession; ciphertextB64: string }> {
  if (!session.state) throw new Error("No MLS group state");
  const impl = await getImpl();
  const result = await createApplicationMessage(
    session.state,
    textEnc.encode(plaintext),
    impl
  );
  result.consumed.forEach(zeroOutUint8Array);
  const ciphertextB64 = encodeWire({
    version: "mls10",
    wireformat: "mls_private_message",
    privateMessage: result.privateMessage,
  });
  return {
    session: { ...session, state: result.newState },
    ciphertextB64,
  };
}

/** Decrypt application MLS private message. */
export async function decryptApp(
  session: MlsSession,
  ciphertextB64: string
): Promise<{ session: MlsSession; text: string }> {
  if (!session.state) throw new Error("No MLS group state");
  const impl = await getImpl();
  const msg = decodeWire(ciphertextB64);
  if (msg.wireformat !== "mls_private_message") {
    throw new Error("Expected mls_private_message");
  }
  const result = await processPrivateMessage(
    session.state,
    msg.privateMessage,
    emptyPskIndex,
    impl
  );
  result.consumed.forEach(zeroOutUint8Array);
  if (result.kind !== "applicationMessage") {
    // Could be a commit misrouted as app — still advance state
    return { session: { ...session, state: result.newState }, text: "" };
  }
  return {
    session: { ...session, state: result.newState },
    text: textDec.decode(result.message),
  };
}

/**
 * Human-comparable safety number from confirmed transcript hash (epoch-bound).
 * Format matches legacy: `XXXXX XXXXX XXXXX`.
 */
export function epochSafetyNumber(session: MlsSession): string | null {
  if (!session.state) return null;
  const hash = session.state.groupContext.confirmedTranscriptHash;
  const dig = sha256(hash);
  const parts: string[] = [];
  for (let i = 0; i < 3; i++) {
    const n =
      ((dig[i * 3]! << 16) | (dig[i * 3 + 1]! << 8) | dig[i * 3 + 2]!) >>> 0;
    parts.push(String(n % 100_000).padStart(5, "0"));
  }
  return parts.join(" ");
}

export function hasMlsGroup(session: MlsSession | null | undefined): boolean {
  return !!session?.state;
}

export function mlsEpoch(session: MlsSession): string | null {
  if (!session.state) return null;
  return session.state.groupContext.epoch.toString();
}

/** Marker stored in protocol message.nonce for MLS app frames. */
export const MLS_NONCE_MARKER = "mls";
