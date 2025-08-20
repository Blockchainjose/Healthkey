import React, { useMemo, useState, useEffect } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";
import { LocalDataSource } from "./lib/data";
import { useConnection } from "@solana/wallet-adapter-react";
import { Transaction } from "@solana/web3.js";
import { createMemoInstruction } from "@solana/spl-memo";


/** -----------------------------------------------------------
 * HealthKey Dashboard (Previewable)
 * - Toggle "Preview Mode" to see mock data
 * - Minimal, dependency-free styles (no Tailwind required)
 * - Colors: dark gray, highlighter green, aqua, light gray
 * ---------------------------------------------------------- */

type HealthSummary = {
  steps: number;
  calories: number;
  sleepHrs: number;
  sparkline: number[]; // 0..1 values
};

type RewardSummary = {
  balance: number; // in HEALTH
  earnedThisMonth: number; // HEALTH
};

type QuickAction = { label: string; meta?: string; icon?: string };

const COLORS = {
  bg: "#0f1115",
  bgElev: "#141821",
  text: "#D9D9D9",
  muted: "#96A0AE",
  border: "#222836",
  aqua: "#38E5D8",
  green: "#A8FF00",
  white: "#FFFFFF",
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

function formatSleep(hours: number) {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}h ${m}m`;
}

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

export default function App() {
  // UI state
  const [preview, setPreview] = useState(true);
  const [aiInput, setAiInput] = useState("");
  const [chat, setChat] = useState<{ role: "user" | "ai"; text: string }[]>([
    { role: "ai", text: "How can I assist you today?" },
    { role: "user", text: "What are the symptoms of influenza?" },
  ]);

  // Data state
  const [summary, setSummary] = useState(MOCK_SUMMARY);
  const [rewards, setRewards] = useState(MOCK_REWARDS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Wallet
  const { publicKey, connected, sendTransaction } = useWallet();

  // Connection + tx helpers
const { connection } = useConnection();
const [sending, setSending] = useState(false);
const [lastSig, setLastSig] = useState<string | null>(null);

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

    // Build a tx with a single Memo instruction
    const tx = new Transaction().add(
      createMemoInstruction("HealthKey demo: hello, devnet!")
    );

    // Let the wallet sign & send
    const sig = await sendTransaction(tx, connection);

    // Optionally wait for confirmation
    await connection.confirmTransaction(sig, "confirmed");

    setLastSig(sig);
  } catch (e: any) {
    console.error(e);
    setError(e?.message ?? "Failed to send transaction");
  } finally {
    setSending(false);
  }
}

  // Actions (static for now)
  const actions = preview ? MOCK_ACTIONS : [];

  // Single data-loading effect
  useEffect(() => {
    if (preview) {
      // Preview Mode ON → show mock data instantly
      setSummary(MOCK_SUMMARY);
      setRewards(MOCK_REWARDS);
      setError(null);
      setLoading(false);
      return;
    }

    // Preview Mode OFF → load from data source
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

  const handleAiSend = () => {
    if (!aiInput.trim()) return;
    setChat((c) => [...c, { role: "user", text: aiInput.trim() }]);
    // Fake AI reply in preview
    setTimeout(() => {
      setChat((c) => [
        ...c,
        {
          role: "ai",
          text:
            "This is an informational response. For medical advice, please consult a clinician. " +
            "Based on your input, I can also check your recent vitals if you allow data context.",
        },
      ]);
    }, 400);
    setAiInput("");
  };

  return (
    <div style={styles.app}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.logoWrap}>
          <div style={styles.logoIcon} />
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
            <input
              type="checkbox"
              checked={preview}
              onChange={(e) => setPreview(e.target.checked)}
              title="Toggle Preview Data"
            />
          </div>
          <WalletMultiButton />
          <div style={styles.avatar} />
        </div>
      </header>

      {/* Content Grid */}
      <main style={styles.main}>
        {/* Health Summary */}
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

        {/* Rewards */}
        <section style={styles.card}>
          <div style={styles.cardHeader}>Rewards Overview</div>
          {loading && <div style={{ color: COLORS.muted, marginTop: 6 }}>Loading data...</div>}
          {error && <div style={{ color: "tomato", marginTop: 6 }}>{error}</div>}
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 6 }}>
            <div style={styles.balanceBig}>
              {rewards.balance.toLocaleString()} <span style={styles.balanceUnit}>HEALTH</span>
            </div>
            <div style={{ color: COLORS.muted, fontSize: 14 }}>
              Tokens Earned This Month{" "}
              <div style={{ color: COLORS.text, fontSize: 16, marginTop: 4 }}>{rewards.earnedThisMonth}</div>
            </div>
          </div>
          <button style={styles.primaryBtn}>Claim Rewards</button>
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
          <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
  <button style={styles.secondaryBtn}>Connect Device</button>
  <button style={styles.secondaryBtn}>Join Challenge</button>
  <button
    style={styles.secondaryBtn}
    onClick={sendTestTx}
    disabled={sending || !connected}
    title={connected ? "Send a test memo tx on devnet" : "Connect wallet first"}
  >
    {sending ? "Sending…" : "Send Test Tx"}
  </button>
</div>

{lastSig && (
  <div style={{ marginTop: 10 }}>
    <a
      href={`https://explorer.solana.com/tx/${lastSig}?cluster=devnet`}
      target="_blank"
      rel="noreferrer"
      style={{ color: COLORS.aqua, textDecoration: "none" }}
    >
      View transaction on Solana Explorer →
    </a>
  </div>
)}

        </section>

        {/* AI Doctor */}
        <section style={styles.card}>
          <div style={styles.cardHeaderRow}>
            <div>AI Doctor</div>
            <span style={styles.pillMuted}>Info only · Not medical advice</span>
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
            <button style={styles.primaryBtn} onClick={handleAiSend}>Send</button>
          </div>
        </section>
      </main>

      {/* Footer mini note to mirror your site vibe */}
      <footer style={styles.footer}>
        <span style={{ color: COLORS.muted }}>Proudly built on</span>
        <span style={styles.solanaBadge}>Solana</span>
      </footer>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={styles.metric}>
      <div style={styles.metricLabel}>{label}</div>
      <div style={styles.metricValue}>{value}</div>
    </div>
  );
}

/* --------- Styles (no external CSS needed) ---------- */
const styles: Record<string, React.CSSProperties> = {
  app: {
    minHeight: "100vh",
    background: COLORS.bg,
    color: COLORS.text,
    fontFamily:
      "Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
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
  logoIcon: {
    width: 22,
    height: 22,
    borderRadius: 4,
    background: `radial-gradient(circle at 30% 30%, ${COLORS.green}, ${COLORS.aqua})`,
    boxShadow: `0 0 14px ${COLORS.green}`,
  },
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
    width: "96vw", // fill most of the screen width
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
};
