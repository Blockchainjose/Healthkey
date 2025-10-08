import React, { useMemo, useState, useEffect } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { LocalDataSource } from "./lib/data";
import { Transaction } from "@solana/web3.js";
import { createMemoInstruction } from "@solana/spl-memo";
import { WebBundlr } from "@bundlr-network/client";
import healthKeyLogo from "./assets/healthkey-logo.png";

/** -----------------------------------------------------------
 * HealthKey Dashboard (MVP)
 * - Original UI + Colors, plus:
 *   • Records table (mock data) + filters + search
 *   • Consent toggle (mocked)
 *   • Decrypt simulation button (mock)
 *   • Disabled Export button with tooltip
 *   • Record detail panel (right column)
 *   • Audit log panel (placeholder with hints)
 *   • Upload "sheet" (stub) opened from button
 *   • Badges, skeletons, empty/error states
 * ---------------------------------------------------------- */

type HealthSummary = {
  steps: number;
  calories: number;
  sleepHrs: number;
  sparkline: number[]; // 0..1 values
};
type RewardSummary = { balance: number; earnedThisMonth: number };

type QuickAction = { label: string; meta?: string; icon?: string };

type ManualVitals = {
  dateISO: string;       // e.g., "2025-09-20"
  hr: number;            // heart rate
  systolic: number;      // BP systolic
  diastolic: number;     // BP diastolic
  weightLbs: number;     // weight in lbs
  note?: string;         // optional
};


type RecordStatus = "encrypted" | "decrypted" | "error" | "processing";
type RecordRow = {
  id: string;
  name: string;
  type: "Vitals" | "Lab" | "Note" | "Imaging";
  date: string; // YYYY-MM-DD
  status: RecordStatus;
  consent: boolean;
  sizeMB: number;
};

const COLORS = {
  bg: "#0f1115",
  bgElev: "#141821",
  text: "#D9D9D9",
  muted: "#96A0AE",
  border: "#222836",
  aqua: "#38E5D8",
  green: "#A8FF00",
  white: "#FFFFFF",
  danger: "#ff6b6b",
  amber: "#fbbf24",
  blue: "#60a5fa",
  emerald: "#34d399",
};

const MOCK_SUMMARY: HealthSummary = {
  steps: 8456,
  calories: 1230,
  sleepHrs: 7.75,
  sparkline: [0.2, 0.35, 0.3, 0.6, 0.5, 0.7, 0.55, 0.62, 0.48, 0.72, 0.68],
};
const MOCK_REWARDS: RewardSummary = { balance: 1225, earnedThisMonth: 350 };
const MOCK_ACTIONS: QuickAction[] = [
  { label: "Connect Device", icon: "🔗" },
  { label: "Share Data", meta: "Apr 24, 2024", icon: "📤" },
  { label: "Activity Data Synced", meta: "Apr 24, 2024", icon: "✅" },
  { label: "Blood Pressure Logged", meta: "Apr 24, 2024", icon: "🩺" },
];

// --- decrypt helper (AES-GCM) ---
async function decryptBytes(
  cipher: Uint8Array,
  iv: Uint8Array,
  jwk: JsonWebKey
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "AES-GCM" }, false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
  return new Uint8Array(plain);
}

function formatSleep(hours: number) {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}h ${m}m`;
}

// Basic sparkline
function Sparkline({
  points,
  width = 520,
  height = 90,
}: {
  points: number[];
  width?: number;
  height?: number;
}) {
  const path = useMemo(() => {
    if (!points.length) return "";
    const pad = 6;
    const w = width - pad * 2;
    const h = height - pad * 2;
    const maxX = points.length - 1;
    const toX = (i: number) => pad + (i / maxX) * w;
    const toY = (v: number) => pad + (1 - v) * h;
    return points.map((v, i) => `${i === 0 ? "M" : "L"} ${toX(i)} ${toY(v)}`).join(" ");
  }, [points, width, height]);

  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      <defs>
        <linearGradient id="spark" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={COLORS.aqua} stopOpacity="0.9" />
          <stop offset="100%" stopColor={COLORS.aqua} stopOpacity="0.2" />
        </linearGradient>
      </defs>
      <path d={path} fill="none" stroke="url(#spark)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// --- MIME sniffer for previews (jpg/png/gif/pdf/svg + extras) ---
function sniffMime(u8: Uint8Array): string | null {
  // JPEG
  if (u8.length > 3 && u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) return "image/jpeg";
  // PNG
  if (
    u8.length > 8 &&
    u8[0] === 0x89 &&
    u8[1] === 0x50 &&
    u8[2] === 0x4e &&
    u8[3] === 0x47 &&
    u8[4] === 0x0d &&
    u8[5] === 0x0a &&
    u8[6] === 0x1a &&
    u8[7] === 0x0a
  )
    return "image/png";
  // GIF
  if (
    u8.length > 6 &&
    u8[0] === 0x47 &&
    u8[1] === 0x49 &&
    u8[2] === 0x46 &&
    u8[3] === 0x38 &&
    (u8[4] === 0x39 || u8[4] === 0x37) &&
    u8[5] === 0x61
  )
    return "image/gif";
  // WEBP (RIFF....WEBP)
  if (
    u8.length > 12 &&
    u8[0] === 0x52 &&
    u8[1] === 0x49 &&
    u8[2] === 0x46 &&
    u8[3] === 0x46 &&
    u8[8] === 0x57 &&
    u8[9] === 0x45 &&
    u8[10] === 0x42 &&
    u8[11] === 0x50
  )
    return "image/webp";
  // PDF
  if (u8.length > 4 && u8[0] === 0x25 && u8[1] === 0x50 && u8[2] === 0x44 && u8[3] === 0x46)
    return "application/pdf";
  // SVG (rough)
  const head = new TextDecoder().decode(u8.slice(0, 256)).trimStart().slice(0, 12).toLowerCase();
  if (head.startsWith("<svg")) return "image/svg+xml";
  return null;
}

export default function App() {
  // UI state (original)
  const [preview, setPreview] = useState(true);
  const [aiInput, setAiInput] = useState("");
  const [chat, setChat] = useState<{ role: "user" | "ai"; text: string }[]>([
    { role: "ai", text: "How can I assist you today?" },
    { role: "user", text: "What are the symptoms of influenza?" },
  ]);

  // Data state (original)
  const [summary, setSummary] = useState(MOCK_SUMMARY);
  const [rewards, setRewards] = useState(MOCK_REWARDS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Wallet
  const { publicKey, connected, sendTransaction, signTransaction, signMessage } = useWallet();

  // Connection + tx helpers
  const { connection } = useConnection();
  const [sending, setSending] = useState(false);
  const [lastSig, setLastSig] = useState<string | null>(null);

  // Upload state
  const [uploading, setUploading] = useState(false);
  const [arweaveId, setArweaveId] = useState<string | null>(null);
  const [uploadErr, setUploadErr] = useState<string | null>(null);

  // Manual vitals UI state
  const [showManualSheet, setShowManualSheet] = useState(false);
  const [manualVitals, setManualVitals] = useState<ManualVitals>({
  dateISO: "", hr: 0, systolic: 0, diastolic: 0, weightLbs: 0, note: ""
  });
  const [latestVitals, setLatestVitals] = useState<ManualVitals | null>(null);

  const [lastUpload, setLastUpload] = useState<{
    id: string;
    iv: Uint8Array;
    jwk: JsonWebKey;
    mime: string;
    name?: string;
  } | null>(null);

  const [decryptedPreview, setDecryptedPreview] = useState<{ text?: string; json?: any } | null>(
    null
  );
  const [decryptedBlobUrl, setDecryptedBlobUrl] = useState<string | null>(null);

  // Records (NEW MVP surface)
  const [records, setRecords] = useState<RecordRow[]>([
    {
      id: "rec_001",
      name: "Blood Work — Basic Metabolic Panel",
      type: "Lab",
      date: "2025-09-22",
      status: "encrypted",
      consent: true,
      sizeMB: 2.1,
    },
    {
      id: "rec_002",
      name: "Daily Vitals — Week 38",
      type: "Vitals",
      date: "2025-09-20",
      status: "decrypted",
      consent: true,
      sizeMB: 0.2,
    },
    {
      id: "rec_003",
      name: "Clinician Note — Follow-up",
      type: "Note",
      date: "2025-09-18",
      status: "processing",
      consent: false,
      sizeMB: 0.1,
    },
    {
      id: "rec_004",
      name: "Chest X-Ray — DICOM",
      type: "Imaging",
      date: "2025-09-10",
      status: "error",
      consent: true,
      sizeMB: 14.6,
    },
  ]);
  const [recQuery, setRecQuery] = useState("");
  const [recType, setRecType] = useState<"all" | "Vitals" | "Lab" | "Note" | "Imaging">("all");
  const [selectedRec, setSelectedRec] = useState<RecordRow | null>(null);
  const [showUploadSheet, setShowUploadSheet] = useState(false);

  const filteredRecords = records.filter((r) => {
    const matchesQuery = r.name.toLowerCase().includes(recQuery.toLowerCase());
    const matchesType = recType === "all" ? true : r.type === recType;
    return matchesQuery && matchesType;
  });

  // Audit log (placeholder)
  const [audit, setAudit] = useState<
    { icon: string; text: string; sub: string; key: string }[]
  >([
    {
      key: "a1",
      icon: "👁️",
      text: `You viewed Daily Vitals — Week 38`,
      sub: "2025-09-21 • reason: self-access • tx: HKeY…9h4",
    },
    {
      key: "a2",
      icon: "🔒",
      text: `Consent revoked for Clinician Note — Follow-up`,
      sub: "2025-09-19 • scope: clinician • tx: CoNs…1d2",
    },
    {
      key: "a3",
      icon: "🔓",
      text: `Consent granted for Blood Work — Basic Metabolic Panel`,
      sub: "2025-09-22 • scope: self • tx: GrNt…7aa",
    },
  ]);

  // Revoke object URL on unmount/when changed
  useEffect(() => {
    return () => {
      if (decryptedBlobUrl) URL.revokeObjectURL(decryptedBlobUrl);
    };
  }, [decryptedBlobUrl]);

  // Handler: send a simple devnet Memo transaction
  async function sendTestTx() {
    if (!connected || !publicKey) {
      setError("Connect your wallet first");
      return;
    }
    try {
      setSending(true);
      setError(null);
      setLastSig(null);

      const tx = new Transaction().add(createMemoInstruction("HealthKey demo: hello, devnet!"));
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      setLastSig(sig);
    } catch (e: any) {
      console.error(e);
      setError(e?.message ?? "Failed to send transaction");
    } finally {
      setSending(false);
    }
  }

  // Actions (static)
  const actions = preview ? MOCK_ACTIONS : [];

  // Data load effect
  useEffect(() => {
    if (preview) {
      setSummary(MOCK_SUMMARY);
      setRewards(MOCK_REWARDS);
      setError(null);
      setLoading(false);
      return;
    }

    if (!connected || !publicKey) {
      setError("Wallet not connected");
      setSummary({ steps: 0, calories: 0, sleepHrs: 0, sparkline: [] });
      setRewards({ balance: 0, earnedThisMonth: 0 });
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);

        const userId = publicKey.toBase58();
        const [snap, rew] = await Promise.all([
          LocalDataSource.getHealthSnapshot(userId),
          LocalDataSource.getRewards(userId),
        ]);

        if (!cancelled) {
          setSummary(snap);
          setRewards(rew);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to load data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [preview, connected, publicKey]);

  const handleAiSend = async () => {
    if (!aiInput.trim()) return;
    const q = aiInput.trim();
    setChat((c) => [...c, { role: "user", text: q }]);
    setAiInput("");

    try {
      const resp = await fetch("http://localhost:8787/api/ai/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const data = await resp.json();
      if (data.ok) {
        setChat((c) => [...c, { role: "ai", text: data.answer }]);
      } else {
        setChat((c) => [...c, { role: "ai", text: "Error: Could not fetch answer from server." }]);
      }
    } catch (e) {
      console.error("AI fetch error:", e);
      setChat((c) => [...c, { role: "ai", text: "Network error. Is the server running?" }]);
    }
  };

  // --- Encrypt + Upload (Bundlr devnet) + memo pointer ---
  async function encryptBytes(bytes: Uint8Array): Promise<{
    cipher: Uint8Array;
    iv: Uint8Array;
    jwk: JsonWebKey;
  }> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
      "encrypt",
      "decrypt",
    ]);
    const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes);
    const jwk = await crypto.subtle.exportKey("jwk", key);
    return { cipher: new Uint8Array(cipherBuf), iv, jwk };
  }

  // --- Upload via transaction flow (browser-safe) ---
  async function uploadEncryptedToBundlr(
    cipher: Uint8Array,
    contentType = "application/octet-stream",
    iv?: Uint8Array,
    jwk?: JsonWebKey,
    fileName?: string
  ): Promise<string> {
    if (!connected || !publicKey) throw new Error("Connect your wallet first");

    const bundlrWallet = {
      publicKey,
      signTransaction: async (tx: any) => {
        if (!signTransaction) throw new Error("Wallet cannot sign transactions");
        return await signTransaction(tx);
      },
      sendTransaction: async (tx: any) => {
        return await sendTransaction(tx, connection);
      },
      signMessage: async (msg: Uint8Array) => {
        if (!signMessage) throw new Error("Selected Wallet does not support message signing");
        return await signMessage(msg);
      },
    };

    const bundlr = new WebBundlr(
      "https://devnet.bundlr.network",
      "solana",
      bundlrWallet,
      { providerUrl: "https://api.devnet.solana.com" }
    );
    await bundlr.ready();

    const tags = [{ name: "Content-Type", value: contentType }];
    const tx = await bundlr.createTransaction(cipher, { tags });
    const price = await bundlr.getPrice(tx.size);
    const fundAmt = price.multipliedBy(1.05).integerValue();

    console.log("bundlr conf", {
      api: bundlr.apiUrl,
      currency: bundlr.currencyConfig?.name,
      size: tx.size,
      price: price.toString(),
      fundAmt: fundAmt.toString(),
    });

    await bundlr.fund(fundAmt);
    await tx.sign();
    const res = await tx.upload();

    const id = (res?.data?.id ?? res?.id ?? tx.id) as string;
    if (!id) throw new Error("Bundlr upload did not return an id");

    if (iv && jwk) {
      setLastUpload({ id, iv, jwk, mime: contentType, name: fileName });
      setDecryptedPreview(null);
    }
    return id;
  }

  // --- Select + Encrypt + Upload + Memo pointer ---
  async function onSelectFile(file: File) {
    if (!connected || !publicKey) {
      setError("Connect your wallet first");
      return;
    }

    setUploading(true);
    setUploadErr(null);
    setArweaveId(null);

    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const { cipher, iv, jwk } = await encryptBytes(buf);

      const txId = await uploadEncryptedToBundlr(
        cipher,
        file.type || "application/octet-stream",
        iv,
        jwk,
        file.name
      );
      setArweaveId(txId);

      // Optional: memo with pointer
      try {
        const tx = new Transaction().add(createMemoInstruction(`healthkey:uploaded:${txId}`));
        tx.feePayer = publicKey!;
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("finalized");
        tx.recentBlockhash = blockhash;

        const sig = await sendTransaction(tx, connection, {
          skipPreflight: false,
          preflightCommitment: "confirmed",
        });
        await connection.confirmTransaction(
          { signature: sig, blockhash, lastValidBlockHeight },
          "confirmed"
        );
        setLastSig(sig);

        // log to audit (placeholder)
        setAudit((list) => [
          {
            key: `u-${Date.now()}`,
            icon: "⬆️",
            text: `Uploaded ${file.name}`,
            sub: `now • tx: ${txId.slice(0, 4)}…${txId.slice(-3)}`,
          },
          ...list,
        ]);
      } catch (err: any) {
        try {
          const simTx = new Transaction().add(createMemoInstruction(`healthkey:uploaded:${txId}`));
          const sim = await connection.simulateTransaction(simTx, {
            sigVerify: false,
            commitment: "processed",
          });
          console.log("simulate err:", sim.value.err, "logs:", sim.value.logs);
        } catch {}
        console.error("sendTransaction error:", err);
        setError(err?.message ?? "Failed to send memo tx");
        return;
      }
    } catch (e: any) {
      console.error("upload flow error:", e);
      setUploadErr(e?.message ?? "Upload failed");
    } finally {
      setUploading(false);
      setShowUploadSheet(false);
    }
  } // end onSelectFile
async function onSubmitManualVitals() {
  try {
    if (!connected || !publicKey) {
      setError("Connect your wallet first");
      return;
    }

    // Basic validation
    if (!manualVitals.dateISO || !manualVitals.hr || !manualVitals.systolic || !manualVitals.diastolic || !manualVitals.weightLbs) {
      setError("Please fill all required fields.");
      return;
    }

    // 1) Build a JSON payload (include metadata you might want later)
    const payload = {
      kind: "healthkey.vitals.manual",
      createdAt: new Date().toISOString(),
      owner: publicKey?.toBase58(),
      data: manualVitals,           // the vitals
      version: 1,
    };
    const json = new TextEncoder().encode(JSON.stringify(payload));

    // 2) Encrypt client-side
    const { cipher, iv, jwk } = await encryptBytes(json);

    // 3) Upload encrypted JSON to Bundlr/Irys
    const fileName = `vitals_${manualVitals.dateISO}.json`;
    const txId = await uploadEncryptedToBundlr(cipher, "application/json", iv, jwk, fileName);
    setArweaveId(txId);

    // 4) Update dashboard UI
    setLatestVitals(manualVitals);

    // Add a row into Records table (type = Vitals)
    setRecords((rows) => [
      {
        id: `rec_${Date.now()}`,
        name: `Manual Vitals — ${manualVitals.dateISO}`,
        type: "Vitals",
        date: manualVitals.dateISO,
        status: "encrypted",      // it is stored encrypted on-chain storage
        consent: true,            // mock default
        sizeMB: +(json.byteLength / (1024 * 1024)).toFixed(2),
      },
      ...rows,
    ]);

    // Add to audit log (placeholder)
    setAudit((list) => [
      {
        key: `m-${Date.now()}`,
        icon: "📝",
        text: `Added manual vitals (${manualVitals.dateISO})`,
        sub: `now • tx: ${txId.slice(0,4)}…${txId.slice(-3)}`,
      },
      ...list,
    ]);

    // Reset + close sheet
    setManualVitals({ dateISO: "", hr: 0, systolic: 0, diastolic: 0, weightLbs: 0, note: "" });
    setShowManualSheet(false);
    setError(null);
  } catch (e: any) {
    console.error("manual vitals submit error:", e);
    setError(e?.message ?? "Failed to submit manual vitals");
  }
}

  // --- Retrieve & Decrypt ---
  const handleRetrieve = async () => {
    try {
      if (!lastUpload) return;
      const url = `https://gateway.irys.xyz/${lastUpload.id}`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`);
      const cipher = new Uint8Array(await resp.arrayBuffer());

      const plain = await decryptBytes(cipher, lastUpload.iv, lastUpload.jwk);

      const savedMime = (lastUpload.mime || "").toLowerCase();
      const normalizedSavedMime = savedMime === "image/jpg" ? "image/jpeg" : savedMime;
      const sniffed = sniffMime(plain);
      const mime = normalizedSavedMime || sniffed || "application/octet-stream";

      if (
        mime.startsWith("text/") ||
        mime === "application/json" ||
        mime === "application/xml" ||
        mime === "image/svg+xml"
      ) {
        const text = new TextDecoder().decode(plain);
        try {
          if (mime === "application/json") setDecryptedPreview({ json: JSON.parse(text) });
          else setDecryptedPreview({ text });
        } catch {
          setDecryptedPreview({ text });
        }
        if (decryptedBlobUrl) URL.revokeObjectURL(decryptedBlobUrl);
        setDecryptedBlobUrl(null);
      } else {
        const blob = new Blob([plain], { type: mime });
        const objUrl = URL.createObjectURL(blob);
        if (decryptedBlobUrl) URL.revokeObjectURL(decryptedBlobUrl);
        setDecryptedBlobUrl(objUrl);
        setDecryptedPreview(null);
      }

      // audit (placeholder)
      setAudit((list) => [
        {
          key: `r-${Date.now()}`,
          icon: "🗝️",
          text: `Decrypted ${lastUpload.name || "last upload"}`,
          sub: "now • reason: self-access • tx: local",
        },
        ...list,
      ]);
    } catch (err) {
      console.error("decrypt failed", err);
      setDecryptedPreview({ text: "❌ Failed to decrypt" });
      if (decryptedBlobUrl) URL.revokeObjectURL(decryptedBlobUrl);
      setDecryptedBlobUrl(null);
    }
  };

  // Records UI helpers (mock)
  function StatusBadge({ status }: { status: RecordStatus }) {
    const map: Record<
      RecordStatus,
      { label: string; bg: string; border: string; color: string }
    > = {
      encrypted: {
        label: "Encrypted",
        bg: "rgba(96,165,250,0.12)",
        border: COLORS.blue,
        color: COLORS.white,
      },
      decrypted: {
        label: "Decrypted",
        bg: "rgba(52,211,153,0.12)",
        border: COLORS.emerald,
        color: COLORS.white,
      },
      processing: {
        label: "Decrypting…",
        bg: "rgba(251,191,36,0.12)",
        border: COLORS.amber,
        color: COLORS.white,
      },
      error: {
        label: "Decrypt Failed",
        bg: "rgba(255,107,107,0.12)",
        border: COLORS.danger,
        color: COLORS.white,
      },
    };
    const m = map[status];
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "2px 8px",
          borderRadius: 999,
          fontSize: 12,
          background: m.bg,
          border: `1px solid ${m.border}`,
          color: m.color,
        }}
      >
        {m.label}
      </span>
    );
  }

  function Switch({
    checked,
    onChange,
    "aria-label": ariaLabel,
  }: {
    checked: boolean;
    onChange: (next: boolean) => void;
    "aria-label"?: string;
  }) {
    return (
      <button
        aria-label={ariaLabel}
        onClick={() => onChange(!checked)}
        style={{
          width: 44,
          height: 24,
          borderRadius: 999,
          border: `1px solid ${COLORS.border}`,
          background: checked ? COLORS.green : COLORS.bgElev,
          position: "relative",
        }}
        title={checked ? "Consent granted" : "Consent revoked"}
      >
        <span
          style={{
            position: "absolute",
            top: 2,
            left: checked ? 22 : 2,
            width: 20,
            height: 20,
            borderRadius: "50%",
            background: COLORS.white,
          }}
        />
      </button>
    );
  }

  function simulateDecrypt(row: RecordRow) {
    // flip status -> processing -> decrypted (mock)
    setRecords((prev) =>
      prev.map((r) => (r.id === row.id && r.status === "encrypted" ? { ...r, status: "processing" } : r))
    );
    setTimeout(() => {
      setRecords((prev) =>
        prev.map((r) =>
          r.id === row.id && r.status === "processing" ? { ...r, status: "decrypted" } : r
        )
      );
      // audit (placeholder)
      setAudit((list) => [
        {
          key: `d-${Date.now()}`,
          icon: "🗝️",
          text: `Decrypted ${row.name}`,
          sub: "now • reason: self-access • tx: mock",
        },
        ...list,
      ]);
    }, 1200);
  }

  function toggleConsent(id: string) {
    setRecords((prev) =>
      prev.map((r) => (r.id === id ? { ...r, consent: !r.consent } : r))
    );
    const rec = records.find((r) => r.id === id);
    if (rec) {
      setAudit((list) => [
        {
          key: `c-${Date.now()}`,
          icon: rec.consent ? "🔒" : "🔓",
          text: `${rec.consent ? "Consent revoked for" : "Consent granted for"} ${rec.name}`,
          sub: "now • scope: mock • tx: mock",
        },
        ...list,
      ]);
    }
  }

  // ===== Render =====
  return (
    <div style={styles.app}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.logoWrap}>
          <img src={healthKeyLogo} alt="HealthKey Logo" style={{ width: 48, height: 48, objectFit: "contain" }} />
          <div style={styles.logoText}>HEALTHKEY</div>
        </div>
        <nav style={styles.nav}>
          <a style={styles.navLink} href="#">Dashboard</a>
          <a style={styles.navLink} href="#">My Data</a>
          <a style={styles.navLink} href="#">Rewards</a>
          <a style={styles.navLink} href="#">Settings</a>
        </nav>
        <div style={styles.rightControls}>
          <div style={styles.previewToggle}>
            <label style={{ color: COLORS.muted, fontSize: 12, marginRight: 8 }}>Preview Mode</label>
            <input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} title="Toggle Preview Data" />
          </div>
          <WalletMultiButton />
          <div style={styles.avatar} />
        </div>
      </header>

      {/* Content Grid */}
      <main style={styles.main}>
        {/* Left: Health Summary */}
        <section style={styles.card}>
          <div style={styles.cardHeader}>Health Summary</div>
          {loading && <div style={{ color: COLORS.muted, marginTop: 6 }}>Loading data...</div>}
          {error && <div style={{ color: "tomato", marginTop: 6 }}>{error}</div>}
          <div style={styles.metricsRow}>
            <Metric label="Steps" value={summary.steps.toLocaleString()} />
            <Metric label="Calories" value={`${summary.calories.toLocaleString()} kcal`} />
            <Metric label="Sleep" value={formatSleep(summary.sleepHrs)} />
          </div>
          <div style={{ marginTop: 10 }}>
            <Sparkline points={summary.sparkline} />
          </div>
        </section>

        {/* Right: Rewards */}
        <section style={styles.card}>
          <div style={styles.cardHeader}>Rewards Overview</div>
          {loading && <div style={{ color: COLORS.muted, marginTop: 6 }}>Loading data...</div>}
          {error && <div style={{ color: "tomato", marginTop: 6 }}>{error}</div>}
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 6 }}>
            <div style={styles.balanceBig}>
              {rewards.balance.toLocaleString()} <span style={styles.balanceUnit}>HEALTH</span>
            </div>
            <div style={{ color: COLORS.muted, fontSize: 14 }}>
              Tokens Earned This Month
              <div style={{ color: COLORS.text, fontSize: 16, marginTop: 4 }}>{rewards.earnedThisMonth}</div>
            </div>
          </div>
          <button style={styles.primaryBtn}>Claim Rewards</button>
        </section>

        {/* Latest Manual Vitals */}
<section style={styles.card}>
  <div style={styles.cardHeader}>Latest Manual Vitals</div>
  {!latestVitals ? (
    <div style={{ color: COLORS.muted, fontSize: 13 }}>No manual entries yet.</div>
  ) : (
    <div style={{ display: "grid", gap: 8, marginTop: 4 }}>
      <div style={{ color: COLORS.muted, fontSize: 12 }}>{latestVitals.dateISO}</div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div style={styles.metric}>
          <div style={styles.metricLabel}>Heart Rate</div>
          <div style={styles.metricValue}>{latestVitals.hr} bpm</div>
        </div>
        <div style={styles.metric}>
          <div style={styles.metricLabel}>Blood Pressure</div>
          <div style={styles.metricValue}>{latestVitals.systolic}/{latestVitals.diastolic} mmHg</div>
        </div>
        <div style={styles.metric}>
          <div style={styles.metricLabel}>Weight</div>
          <div style={styles.metricValue}>{latestVitals.weightLbs} lbs</div>
        </div>
      </div>
    </div>
  )}
</section>


        {/* Quick Actions */}
        <section style={styles.card}>
          <div style={styles.cardHeader}>Quick Actions</div>

          <ul style={{ listStyle: "none", padding: 0, marginTop: 8 }}>
            {actions.map((a, i) => (
              <li key={i} style={styles.actionItem}>
                <span style={{ marginRight: 10 }}>{a.icon ?? "•"}</span>
                <span style={{ color: COLORS.text }}>{a.label}</span>
                {a.meta && <span style={styles.actionMeta}>{a.meta}</span>}
              </li>
            ))}
          </ul>

          <div style={{ display: "flex", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
            <button style={styles.secondaryBtn} onClick={() => setShowUploadSheet(true)}>
              New Upload
            </button>

            <button
              style={styles.secondaryBtn}
              onClick={() => document.getElementById("fileInput")?.click()}
              title="Upload Health Data (immediate)"
            >
              Upload Health Data
            </button>
            <button style={styles.secondaryBtn} onClick={() => setShowManualSheet(true)}>
              Add Manual Vitals
            </button>

            <input
              id="fileInput"
              type="file"
              accept=".json,.csv,.pdf,.txt,.xml,image/*"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onSelectFile(f);
              }}
            />

            <button
              style={styles.secondaryBtn}
              onClick={sendTestTx}
              disabled={sending || !connected}
              title={connected ? "Send a test memo tx on devnet" : "Connect wallet first"}
            >
              {sending ? "Sending…" : "Send Test Tx"}
            </button>

            <button style={styles.secondaryBtn} onClick={handleRetrieve}>
              Retrieve & Decrypt Last Upload
            </button>
          </div>

          {/* Upload sheet (stub) */}
          {showUploadSheet && (
            <div style={styles.sheetOverlay} onClick={() => setShowUploadSheet(false)}>
              <div style={styles.sheet} onClick={(e) => e.stopPropagation()}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontWeight: 700 }}>Upload (Placeholder)</div>
                  <button style={styles.secondaryBtn} onClick={() => setShowUploadSheet(false)}>
                    Close
                  </button>
                </div>
                <div style={{ marginTop: 12, color: COLORS.muted }}>
                  Drag & drop, client-side encrypt, and upload. This panel is a mock UI surface; use the
                  “Upload Health Data” button above to run the real flow.
                </div>
                <div
                  style={{
                    marginTop: 12,
                    border: `2px dashed ${COLORS.border}`,
                    borderRadius: 14,
                    padding: 24,
                    textAlign: "center",
                    color: COLORS.muted,
                    background: "#0e131b",
                  }}
                >
                  Drop a file here or click to browse.
                  <div style={{ marginTop: 8, fontSize: 12 }}>
                    🔒 Client-side encryption enabled (demo)
                  </div>
                </div>
                <button style={{ ...styles.primaryBtn, marginTop: 16 }} disabled title="Stub only">
                  Encrypt & Upload
                </button>
                <div style={{ marginTop: 8, color: COLORS.muted, fontSize: 12 }}>
                  Note: Wire this panel to your real handler later; the immediate button already works.
                </div>
              </div>
            </div>
          )}
          {/* Manual Vitals sheet */}
{showManualSheet && (
  <div style={styles.sheetOverlay} onClick={() => setShowManualSheet(false)}>
    <div style={styles.sheet} onClick={(e) => e.stopPropagation()}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontWeight: 700 }}>Add Manual Vitals</div>
        <button style={styles.secondaryBtn} onClick={() => setShowManualSheet(false)}>
          Close
        </button>
      </div>

      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
        <label style={{ fontSize: 13 }}>
          Date
          <input
            type="date"
            value={manualVitals.dateISO}
            onChange={(e) => setManualVitals((v) => ({ ...v, dateISO: e.target.value }))}
            style={{ ...styles.input, marginTop: 6 }}
          />
        </label>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label style={{ fontSize: 13 }}>
            Heart Rate (bpm)
            <input
              type="number"
              min={0}
              value={manualVitals.hr || ""}
              onChange={(e) => setManualVitals((v) => ({ ...v, hr: Number(e.target.value) }))}
              style={{ ...styles.input, marginTop: 6 }}
              placeholder="e.g., 67"
            />
          </label>
          <label style={{ fontSize: 13 }}>
            Weight (lbs)
            <input
              type="number"
              min={0}
              value={manualVitals.weightLbs || ""}
              onChange={(e) => setManualVitals((v) => ({ ...v, weightLbs: Number(e.target.value) }))}
              style={{ ...styles.input, marginTop: 6 }}
              placeholder="e.g., 190"
            />
          </label>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label style={{ fontSize: 13 }}>
            BP Systolic
            <input
              type="number"
              min={0}
              value={manualVitals.systolic || ""}
              onChange={(e) => setManualVitals((v) => ({ ...v, systolic: Number(e.target.value) }))}
              style={{ ...styles.input, marginTop: 6 }}
              placeholder="e.g., 122"
            />
          </label>
          <label style={{ fontSize: 13 }}>
            BP Diastolic
            <input
              type="number"
              min={0}
              value={manualVitals.diastolic || ""}
              onChange={(e) => setManualVitals((v) => ({ ...v, diastolic: Number(e.target.value) }))}
              style={{ ...styles.input, marginTop: 6 }}
              placeholder="e.g., 74"
            />
          </label>
        </div>

        <label style={{ fontSize: 13 }}>
          Note (optional)
          <textarea
            value={manualVitals.note || ""}
            onChange={(e) => setManualVitals((v) => ({ ...v, note: e.target.value }))}
            style={{ ...styles.input, marginTop: 6, minHeight: 90, resize: "vertical" }}
            placeholder="Any extra context..."
          />
        </label>

        <button style={{ ...styles.primaryBtn, marginTop: 6 }} onClick={onSubmitManualVitals}>
          Save & Upload
        </button>
        <div style={{ color: COLORS.muted, fontSize: 12 }}>
          This will encrypt your entry client-side and store it via Irys (Arweave devnet).
        </div>
      </div>
    </div>
  </div>
)}

          {/* Upload status + links */}
          {uploading && (
            <div style={{ marginTop: 8, color: COLORS.muted }}>Uploading encrypted file to Bundlr…</div>
          )}
          {uploadErr && <div style={{ marginTop: 8, color: "tomato" }}>{uploadErr}</div>}
          {arweaveId && (
            <div style={{ marginTop: 10 }}>
              <div style={{ marginBottom: 6 }}>Stored encrypted data on Arweave (via Bundlr/Irys):</div>
              <div>
                <a
                  href={`https://devnet.irys.xyz/tx/${arweaveId}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: COLORS.aqua, textDecoration: "none", marginRight: 12 }}
                >
                  View on Arweave Devnet → (encrypted)
                </a>
                <a
                  href={`https://gateway.irys.xyz/${arweaveId}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: COLORS.aqua, textDecoration: "none" }}
                >
                  Retrieve Raw Data → (encrypted)
                </a>
              </div>
            </div>
          )}
          {lastSig && (
            <div style={{ marginTop: 10 }}>
              <a
                href={`https://explorer.solana.com/tx/${lastSig}?cluster=devnet`}
                target="_blank"
                rel="noreferrer"
                style={{ color: COLORS.aqua, textDecoration: "none" }}
              >
                View memo transaction →
              </a>
            </div>
          )}

          {/* Decrypt preview */}
          {decryptedPreview && (
            <div style={{ marginTop: 12 }}>
              <div style={{ color: COLORS.muted, marginBottom: 6 }}>Decrypted Preview:</div>
              {decryptedPreview.json ? (
                <pre style={styles.preBlock}>{JSON.stringify(decryptedPreview.json, null, 2)}</pre>
              ) : (
                <pre style={styles.preBlock}>{decryptedPreview.text}</pre>
              )}
            </div>
          )}
          {decryptedBlobUrl && lastUpload && (
            <div style={{ marginTop: 12 }}>
              {/* Inline if image */}
              {lastUpload.mime.startsWith("image/") && (
                <img
                  src={decryptedBlobUrl}
                  alt="Decrypted preview"
                  style={{ maxWidth: "100%", borderRadius: 10, border: `1px solid ${COLORS.border}` }}
                />
              )}
              {/* Inline if PDF */}
              {lastUpload.mime === "application/pdf" && (
                <iframe
                  src={decryptedBlobUrl}
                  style={{ width: "100%", height: 420, border: `1px solid ${COLORS.border}`, borderRadius: 10 }}
                  title="Decrypted PDF"
                />
              )}
              {/* Fallback: open/download */}
              <div style={{ marginTop: 8 }}>
                <a
                  href={decryptedBlobUrl}
                  download={lastUpload?.name || `healthkey.${(lastUpload.mime.split("/")[1] || "bin")}`}
                  style={{ color: COLORS.aqua, textDecoration: "none", marginRight: 12 }}
                >
                  Download Decrypted File →
                </a>
                <a
                  href={decryptedBlobUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: COLORS.aqua, textDecoration: "none" }}
                >
                  Open in New Tab →
                </a>
              </div>
            </div>
          )}
        </section>

        {/* NEW: Records Table (left, spans both columns on small screens) */}
        <section style={{ ...styles.card, gridColumn: "1 / -1" }}>
          <div style={styles.cardHeaderRow}>
            <div>
              <div style={{ fontWeight: 700 }}>Records</div>
              <div style={{ color: COLORS.muted, fontSize: 12 }}>
                Includes consent toggle, decrypt simulation, export (disabled), and detail panel.
              </div>
            </div>
            <div title="Placeholders wired for demo flow" style={styles.pillMuted}>
              MVP Placeholders
            </div>
          </div>

          {/* Filters */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 200px 200px",
              gap: 12,
              marginTop: 8,
            }}
          >
            <div style={{ position: "relative" }}>
              <input
                style={{ ...styles.input, paddingLeft: 36 }}
                placeholder="Search records…"
                value={recQuery}
                onChange={(e) => setRecQuery(e.target.value)}
              />
              <span style={{ position: "absolute", top: 10, left: 12, opacity: 0.7 }}>🔎</span>
            </div>
            <select
              value={recType}
              onChange={(e) => setRecType(e.target.value as any)}
              style={{ ...styles.input, appearance: "none", cursor: "pointer" }}
              title="Filter by type"
            >
              <option value="all">All Types</option>
              <option value="Vitals">Vitals</option>
              <option value="Lab">Lab</option>
              <option value="Note">Note</option>
              <option value="Imaging">Imaging</option>
            </select>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={styles.badgeSoft}>🗄️ {filteredRecords.length} records</span>
              <span style={styles.badgeSoft}>🛡️ Consent mock</span>
            </div>
          </div>

          {/* Table */}
          <div style={{ marginTop: 10, border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#0e131b" }}>
                  <th style={styles.thNarrow} />
                  <th style={styles.th}>Name</th>
                  <th style={styles.th}>Type</th>
                  <th style={styles.th}>Date</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>Consent</th>
                  <th style={{ ...styles.th, textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecords.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={styles.td}>
                      <div style={{ textAlign: "center", color: COLORS.muted, padding: 20 }}>
                        No records match your filters.
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredRecords.map((row) => (
                    <tr key={row.id} style={{ borderTop: `1px solid ${COLORS.border}` }}>
                      <td style={styles.td}>
                        <button
                          style={styles.iconBtn}
                          onClick={() => setSelectedRec(row)}
                          title="Open details"
                        >
                          👁️
                        </button>
                      </td>
                      <td style={{ ...styles.td, fontWeight: 600 }}>{row.name}</td>
                      <td style={styles.td}>
                        <span style={styles.badgeOutline}>{row.type}</span>
                      </td>
                      <td style={{ ...styles.td, fontVariantNumeric: "tabular-nums" }}>{row.date}</td>
                      <td style={styles.td}>
                        {row.status === "processing" ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <StatusBadge status={row.status} />
                            <span style={styles.skeleton} />
                          </div>
                        ) : (
                          <StatusBadge status={row.status} />
                        )}
                      </td>
                      <td style={styles.td}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <Switch
                            checked={row.consent}
                            onChange={() => toggleConsent(row.id)}
                            aria-label="Toggle consent"
                          />
                          <span style={{ fontSize: 12, color: COLORS.muted }}>
                            {row.consent ? "granted" : "revoked"}
                          </span>
                        </div>
                      </td>
                      <td style={{ ...styles.td, textAlign: "right" }}>
                        <div style={{ display: "inline-flex", gap: 8 }}>
                          <button
                            style={styles.secondaryBtn}
                            onClick={() => simulateDecrypt(row)}
                            disabled={row.status === "decrypted" || row.status === "processing"}
                            title="Simulates decrypt flow (placeholder only)"
                          >
                            Decrypt
                          </button>
                          <button
                            style={{ ...styles.secondaryBtn, opacity: 0.5, cursor: "not-allowed" }}
                            disabled
                            title="Export coming soon (CSV / PDF)"
                          >
                            Export
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div style={{ color: COLORS.muted, fontSize: 12, marginTop: 6 }}>
            Note: Decrypt, consent enforcement, and export are mocked. Replace handlers with real logic once available.
          </div>

          {/* Details + Audit (two-column responsive) */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
            {/* Record detail */}
            <div style={styles.cardInner}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Record Detail</div>
              <div style={{ color: COLORS.muted, fontSize: 12, marginBottom: 8 }}>
                Preview, consent, history, and export controls.
              </div>
              {selectedRec ? (
                <div style={{ display: "grid", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{selectedRec.name}</div>
                      <div style={{ color: COLORS.muted, fontSize: 12 }}>
                        {selectedRec.type} • {selectedRec.date} • {selectedRec.sizeMB} MB
                      </div>
                    </div>
                    <StatusBadge status={selectedRec.status} />
                  </div>
                  <div style={{ borderTop: `1px solid ${COLORS.border}` }} />
                  <div
                    style={{
                      borderRadius: 12,
                      border: `1px solid ${COLORS.border}`,
                      background: "#0e131b",
                      padding: 12,
                      color: COLORS.muted,
                      fontSize: 13,
                    }}
                  >
                    Inline preview will render here after decryption (PDF/text/image depending on record type).
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      style={{ ...styles.secondaryBtn, opacity: 0.65, cursor: "not-allowed" }}
                      disabled
                      title="Export coming soon"
                    >
                      Export
                    </button>
                    <button
                      style={styles.primaryBtn}
                      disabled={selectedRec.status !== "encrypted"}
                      onClick={() => simulateDecrypt(selectedRec)}
                      title="Simulate decrypt (mock)"
                    >
                      Decrypt
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ color: COLORS.muted, fontSize: 13 }}>Select a record to see details here.</div>
              )}
            </div>

            {/* Audit log */}
            <div style={styles.cardInner}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Audit Log</div>
              <div style={{ color: COLORS.muted, fontSize: 12, marginBottom: 8 }}>
                Who accessed what, when, and why.
              </div>
              <div style={{ display: "grid", gap: 8, maxHeight: 320, overflowY: "auto", paddingRight: 6 }}>
                {audit.map((a) => (
                  <div key={a.key} style={{ display: "flex", gap: 10, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 10 }}>
                    <div style={{ opacity: 0.8 }}>{a.icon}</div>
                    <div>
                      <div style={{ fontSize: 14 }}>{a.text}</div>
                      <div style={{ color: COLORS.muted, fontSize: 12 }}>{a.sub}</div>
                    </div>
                  </div>
                ))}
                {/* Hookup hint */}
                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    border: `1px dashed ${COLORS.border}`,
                    borderRadius: 12,
                    padding: 10,
                  }}
                >
                  <div style={{ opacity: 0.8 }}>💡</div>
                  <div>
                    <div style={{ fontSize: 14 }}>
                      Hook this panel to your on-chain events and storage reads.
                    </div>
                    <div style={{ color: COLORS.muted, fontSize: 12 }}>
                      For MVP: write a log entry each time decrypt() succeeds or a consent switch is toggled.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* AI Doctor / Ask HealthKey */}
        <section style={styles.card}>
          <div style={styles.cardHeaderRow}>
            <div>Ask HealthKey</div>
            <span style={styles.pillMuted}>This is information only · Not medical advice</span>
          </div>

          <div style={styles.chatBox}>
            {chat.map((m, i) => (
              <div
                key={i}
                style={{
                  ...styles.msg,
                  ...(m.role === "ai" ? styles.msgAI : styles.msgUser),
                }}
              >
                {m.text}
              </div>
            ))}
          </div>

          <div style={styles.chatInputRow}>
            <input
              style={styles.input}
              placeholder="Enter a symptom or health question…"
              value={aiInput}
              onChange={(e) => setAiInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAiSend()}
            />
            <button style={styles.primaryBtn} onClick={handleAiSend}>
              Ask
            </button>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer style={styles.footer}>
        <span style={{ color: COLORS.muted }}>Proudly built on</span>
        <span style={styles.solanaBadge}>Solana</span>
      </footer>
    </div>
  );
} // end App

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={styles.metric}>
      <div style={styles.metricLabel}>{label}</div>
      <div style={styles.metricValue}>{value}</div>
    </div>
  );
}

/* --------- Styles ---------- */
const styles: Record<string, React.CSSProperties> = {
  app: {
    minHeight: "100vh",
    background: COLORS.bg,
    color: COLORS.text,
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
    overflowX: "hidden",
  },
  header: {
    position: "sticky",
    top: 0,
    zIndex: 50,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "14px 22px",
    background: "rgba(15,17,21,0.9)",
    borderBottom: `1px solid ${COLORS.border}`,
    backdropFilter: "blur(6px)",
  },
  logoWrap: { display: "flex", alignItems: "center", gap: 10 },
  logoText: { fontWeight: 800, letterSpacing: 1, color: COLORS.green },
  nav: { display: "flex", gap: 18, alignItems: "center" },
  navLink: { color: COLORS.muted, textDecoration: "none", fontSize: 14 },
  rightControls: { display: "flex", alignItems: "center", gap: 12 },
  previewToggle: { display: "flex", alignItems: "center", gap: 6 },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: "50%",
    background: COLORS.bgElev,
    border: `1px solid ${COLORS.border}`,
  },

  main: {
    width: "96vw",
    margin: "26px auto 40px",
    padding: "0 18px",
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 18,
  },

  card: {
    background: COLORS.bgElev,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 14,
    padding: 16,
    boxShadow: "0 0 0 1px rgba(0,0,0,0.2)",
  },
  cardInner: {
    background: "#10151d",
    border: `1px solid ${COLORS.border}`,
    borderRadius: 12,
    padding: 12,
  },
  cardHeader: { fontWeight: 700, fontSize: 16, marginBottom: 6 },
  cardHeaderRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    fontWeight: 700,
    fontSize: 16,
    marginBottom: 6,
  },

  metricsRow: { display: "flex", gap: 16, marginTop: 4, flexWrap: "wrap" },
  metric: {
    background: "#10151d",
    border: `1px solid ${COLORS.border}`,
    borderRadius: 10,
    padding: "12px 14px",
    minWidth: 150,
  },
  metricLabel: { color: COLORS.muted, fontSize: 12 },
  metricValue: { marginTop: 6, fontSize: 22, fontWeight: 700 },

  balanceBig: { fontSize: 28, fontWeight: 800 },
  balanceUnit: { color: COLORS.muted, fontWeight: 600, fontSize: 14, marginLeft: 6 },

  primaryBtn: {
    marginTop: 14,
    background: COLORS.green,
    color: "#111",
    border: "none",
    padding: "10px 14px",
    borderRadius: 10,
    fontWeight: 800,
    cursor: "pointer",
    boxShadow: `0 0 14px ${COLORS.green}`,
  },
  secondaryBtn: {
    background: "transparent",
    color: COLORS.text,
    border: `1px solid ${COLORS.border}`,
    padding: "10px 14px",
    borderRadius: 10,
    fontWeight: 600,
    cursor: "pointer",
  },

  actionItem: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    justifyContent: "space-between",
    borderBottom: `1px dashed ${COLORS.border}`,
    padding: "10px 2px",
  },
  actionMeta: { color: COLORS.muted, fontSize: 12 },

  chatBox: {
    background: "#0e131b",
    border: `1px solid ${COLORS.border}`,
    borderRadius: 12,
    padding: 12,
    height: 210,
    overflowY: "auto",
    marginTop: 8,
  },
  msg: {
    maxWidth: "85%",
    margin: "8px 0",
    padding: "8px 10px",
    borderRadius: 10,
    lineHeight: 1.35,
    fontSize: 14,
  },
  msgAI: { background: "rgba(56,229,216,0.1)", border: `1px solid ${COLORS.aqua}` },
  msgUser: {
    background: "rgba(168,255,0,0.08)",
    border: `1px solid ${COLORS.green}`,
    marginLeft: "auto",
  },

  chatInputRow: { display: "flex", gap: 10, marginTop: 10 },
  input: {
    flex: 1,
    background: "#0e131b",
    border: `1px solid ${COLORS.border}`,
    color: COLORS.text,
    padding: "10px 12px",
    borderRadius: 10,
    outline: "none",
  },

  pillMuted: {
    fontSize: 11,
    color: COLORS.muted,
    border: `1px solid ${COLORS.border}`,
    padding: "4px 8px",
    borderRadius: 999,
  },

  footer: {
    width: "96vw",
    margin: "10px auto 30px",
    padding: "0 18px",
    display: "flex",
    alignItems: "center",
    gap: 10,
    color: COLORS.muted,
  },
  solanaBadge: {
    marginLeft: 6,
    padding: "4px 8px",
    borderRadius: 8,
    background: "linear-gradient(135deg, #14F195, #00FFA3, #02E2FF)",
    color: "#06141a",
    fontWeight: 800,
    letterSpacing: 0.3,
  },

  // Table styles
  th: {
    textAlign: "left",
    fontWeight: 700,
    fontSize: 13,
    color: COLORS.muted,
    padding: "10px 12px",
  },
  thNarrow: {
    width: 42,
    textAlign: "left",
    fontWeight: 700,
    fontSize: 13,
    color: COLORS.muted,
    padding: "10px 12px",
  },
  td: {
    padding: "10px 12px",
    fontSize: 14,
  },
  iconBtn: {
    background: "transparent",
    color: COLORS.text,
    border: `1px solid ${COLORS.border}`,
    width: 32,
    height: 32,
    borderRadius: 8,
    cursor: "pointer",
  },
  badgeOutline: {
    display: "inline-flex",
    alignItems: "center",
    padding: "2px 8px",
    borderRadius: 999,
    border: `1px solid ${COLORS.border}`,
    fontSize: 12,
  },
  badgeSoft: {
    display: "inline-flex",
    alignItems: "center",
    padding: "4px 8px",
    borderRadius: 999,
    border: `1px solid ${COLORS.border}`,
    background: "#10151d",
    fontSize: 12,
  },
  skeleton: {
    width: 70,
    height: 14,
    background: "linear-gradient(90deg, #111620 0%, #1a2230 50%, #111620 100%)",
    borderRadius: 6,
    animation: "pulse 1.2s ease-in-out infinite",
  },

  preBlock: {
    whiteSpace: "pre-wrap",
    background: "#0e131b",
    border: `1px solid ${COLORS.border}`,
    padding: 12,
    borderRadius: 10,
    maxHeight: 300,
    overflow: "auto",
  },

  // Simple "sheet"
  sheetOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.5)",
    display: "flex",
    justifyContent: "flex-end",
    zIndex: 100,
  },
  sheet: {
    width: "min(520px, 100vw)",
    height: "100%",
    background: COLORS.bgElev,
    borderLeft: `1px solid ${COLORS.border}`,
    padding: 16,
  },
};
