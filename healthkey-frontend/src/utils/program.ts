import { Program, AnchorProvider, web3 } from "@coral-xyz/anchor";
import idl from "../idl/healthkey_protocol.json";

export function getProgram(wallet: any): Program {
  const connection = new web3.Connection(web3.clusterApiUrl("devnet"));
  const provider = new AnchorProvider(connection, wallet, {
    preflightCommitment: "processed",
  });
// eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _programId = new web3.PublicKey("2aPJ91YqkdpSTucNwBxGa42uwoHUCdhx6A4qeBkBrNkJ");

  return new Program(idl as any, provider);
}
