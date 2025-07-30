const anchor = require("@coral-xyz/anchor");
const { PublicKey } = require("@solana/web3.js");

console.log("🚀 Script started"); // This should always print

const main = async () => {
  try {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.HealthkeyProtocol;

    console.log("📡 Program ID:", program.programId.toBase58());

    const [vaultPDA, bump] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault")],
      program.programId
    );

    console.log("🔐 Vault PDA:", vaultPDA.toBase58());
    console.log("🎉 Reward script ran successfully!");
  } catch (err) {
    console.error("❌ Error inside main():", err);
  }
};

main();
