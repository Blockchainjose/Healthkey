const anchor = require("@coral-xyz/anchor");
const { PublicKey } = require("@solana/web3.js");

console.log("🚀 Script started");

const main = async () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.HealthkeyProtocol;

  console.log("📡 Program ID:", program.programId.toBase58());

  const [vaultPDA, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault")],
    program.programId
  );

  console.log("🔐 Vault PDA:", vaultPDA.toBase58());
  console.log("✅ Script completed successfully");
};

main().catch((err) => {
  console.error("❌ Error running script:", err);
});
