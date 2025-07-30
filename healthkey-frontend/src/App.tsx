import { clusterApiUrl } from "@solana/web3.js";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";
import {
  ConnectionProvider,
  WalletProvider,
  useWallet,
} from "@solana/wallet-adapter-react";
import {
  WalletModalProvider,
  WalletMultiButton,
} from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-wallets";


import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  AccountLayout,
} from "@solana/spl-token";

import { Connection, PublicKey } from "@solana/web3.js";

async function getTokenAccountBalance(connection: Connection, ata: PublicKey): Promise<number> {
  const accountInfo = await connection.getAccountInfo(ata);

  if (!accountInfo) {
    return 0;
  }

  const accountData = AccountLayout.decode(accountInfo.data);
  const amount = Number(accountData.amount);
  return amount / 50_000_000_000; 
}

import { BN } from "bn.js";
import "@solana/wallet-adapter-react-ui/styles.css";
import { AnchorProvider, Program, } from "@coral-xyz/anchor";
import idl from "./idl/healthkey.json";

// Constants
const MINT = new PublicKey("DLqxCH34uPm6jcZa8ZYG5KS7LwavutPJaZn5tVPdLhjA");
const VAULT_AUTHORITY_SEED = "vault";
const AMOUNT = new BN(50_000_000_000); // 50 tokens with 9 decimals
const PROGRAM_ID = new PublicKey(idl.address);

function getProgram(wallet: any) {
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
  const provider = new AnchorProvider(connection, wallet, {
    preflightCommitment: "confirmed",
  });
  return new Program(idl as any, PROGRAM_ID, provider);
}

const AppContent: React.FC = () => {
  const wallet = useWallet();
  const [balance, setBalance] = useState<number | null>(null);
  const [goal, setGoal] = useState("");
  const [hash, setHash] = useState("");

  useEffect(() => {
    const fetchBalance = async () => {
      if (!wallet.connected || !wallet.publicKey) return;
      const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
      const ata = await getAssociatedTokenAddress(MINT, wallet.publicKey);
      try {
      const raw = await getTokenAccountBalance(connection, ata);
      setBalance(raw);
      } catch {
        setBalance(0);
      }
    };
    fetchBalance();
  }, [wallet.connected, wallet.publicKey]);

  const callRewardUser = useCallback(async () => {
    if (!wallet.connected || !wallet.signTransaction) {
      alert("Please connect your wallet.");
      return;
    }

    try {
      const program = getProgram(wallet);

      const [vaultAuthority] = PublicKey.findProgramAddressSync(
        [Buffer.from(VAULT_AUTHORITY_SEED)],
        program.programId
      );

      const vaultTokenAccount = await getAssociatedTokenAddress(
        MINT,
        vaultAuthority,
        true
      );
      const userTokenAccount = await getAssociatedTokenAddress(
        MINT,
        wallet.publicKey!
      );

      const tx = await program.methods
        .rewardUser(AMOUNT)
        .accounts({
          vaultAuthority,
          vaultTokenAccount,
          userTokenAccount,
          user: wallet.publicKey!,
          mint: MINT,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      console.log("✅ Transaction successful:", tx);
      alert(`Success! Signature: ${tx}`);
    } catch (err) {
      console.error("❌ Error:", err);
      alert("Transaction failed. Check the console for details.");
    }
  }, [wallet]);

  const callInitializeProfile = useCallback(async () => {
    if (!wallet.connected || !wallet.signTransaction) {
      alert("Please connect your wallet.");
      return;
    }

    try {
      const program = getProgram(wallet);

      const [userProfile] = PublicKey.findProgramAddressSync(
        [Buffer.from("user_profile"), wallet.publicKey!.toBuffer()],
        program.programId
      );

      const tx = await program.methods
        .initializeUserProfile(hash, goal)
        .accounts({
          userProfile,
          authority: wallet.publicKey!,
          systemProgram: new PublicKey("11111111111111111111111111111111"),
        })
        .rpc();

      console.log("✅ Profile initialized:", tx);
      alert(`Profile created! Signature: ${tx}`);
    } catch (err) {
      console.error("❌ Profile error:", err);
      alert("Initialization failed.");
    }
  }, [wallet, hash, goal]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#131313] to-[#1E1E2F] text-white flex flex-col items-center justify-center px-6 py-10">
      <div className="absolute top-5 right-5">
        <WalletMultiButton className="!bg-[#9945FF] !hover:bg-[#8752CC] !text-white !rounded-full !px-5 !py-2 !shadow-lg" />
      </div>

      <main className="text-center max-w-2xl">
        <h1 className="text-4xl sm:text-5xl font-bold text-[#9945FF] mb-6">Welcome to HealthKey</h1>
        <p className="text-lg sm:text-xl leading-relaxed text-gray-300 mb-8">
          HealthKey is your decentralized gateway to own, share, and earn from your health data.
        </p>

        {wallet.connected && (
          <p className="mb-4 text-sm text-[#00FFBD]">
            Balance: {balance !== null ? `${balance} $HEALTH` : "..."}
          </p>
        )}

        <button
          onClick={callRewardUser}
          disabled={!wallet.connected}
          className="bg-[#00FFBD] text-black font-semibold px-6 py-3 rounded-full shadow-md hover:scale-105 transition mb-8"
        >
          Reward User (50 $HEALTH)
        </button>

        <div className="bg-[#1f1f2f] p-6 rounded-xl shadow-md">
          <h2 className="text-lg font-bold mb-4 text-white">Initialize User Profile</h2>
          <input
            type="text"
            value={hash}
            onChange={(e) => setHash(e.target.value)}
            placeholder="Arweave Hash"
            className="block w-full mb-3 px-4 py-2 rounded bg-gray-800 text-white"
          />
          <input
            type="text"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="Your Health Goal"
            className="block w-full mb-3 px-4 py-2 rounded bg-gray-800 text-white"
          />
          <button
            onClick={callInitializeProfile}
            disabled={!wallet.connected}
            className="bg-[#9945FF] hover:bg-[#8752CC] text-white px-4 py-2 rounded-full"
          >
            Create Profile
          </button>
        </div>
      </main>

      <footer className="mt-20 text-sm text-gray-400">
        Built on <span className="text-[#00FFBD] font-semibold">Solana</span>
      </footer>
    </div>
  );
};

const App: React.FC = () => {
  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);
  const endpoint = clusterApiUrl("devnet");

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <AppContent />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
};

export default App;
