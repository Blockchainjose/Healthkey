// Polyfills for Bundlr/web3 libs in Vite
import { Buffer } from "buffer";
import process from "process";

(window as any).global = window;
(window as any).Buffer = Buffer;
(window as any).process = process;

import './index.css';
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-wallets";
import { clusterApiUrl } from "@solana/web3.js";

import "@solana/wallet-adapter-react-ui/styles.css"; // important!

const network = "devnet";
const endpoint = clusterApiUrl(network);
const wallets = [new PhantomWalletAdapter()];

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <App />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  </React.StrictMode>
);
