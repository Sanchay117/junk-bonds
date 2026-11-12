// The film's narration, in order. `text` is what the captions show; `say` (when set) is what the
// voice reads, spelled for the ear. scripts/voice.ts turns each entry into public/vo/<id>.wav and
// records its word timing in public/vo/manifest.json.

export interface Line {
  id: string;
  text: string;
  say?: string;
  /** Seconds of picture before the narrator starts. */
  lead?: number;
  /** Seconds of picture after the narrator stops. */
  tail?: number;
  /** Speeds the take up without changing its pitch. */
  tempo?: number;
}

export const SCRIPT: Line[] = [
  {
    id: "hook",
    text: "On-chain games make you install a wallet before you can play. And the opponents are scripts on somebody's server.",
    lead: 0.4,
    tail: 0.5,
  },
  {
    id: "name",
    text: "This is Junk Bonds. Five raccoons, each with its own NEAR wallet, auction junk that pays you yield until it rots.",
    say: "This is Junk Bonds. Five raccoons, each with its own near wallet, auction junk that pays you yield, until it rots.",
    lead: 0.5,
    tail: 0.7,
  },
  {
    id: "join",
    text: "It is live on NEAR testnet. Type a name, and the contract makes you a real NEAR account. No wallet. About three seconds.",
    say: "It is live on near test net. Type a name, and the contract makes you a real near account. No wallet. About three seconds.",
    lead: 0.5,
    tail: 0.6,
  },
  {
    id: "bid",
    text: "The raccoons bid every few seconds, and their rules run inside the contract. Call dibs and your bid is held. Win, and it burns.",
    lead: 0.4,
    tail: 0.9,
  },
  {
    id: "junk",
    text: "The junk you win is its own NEAR account. Coupons land in it every round. Sell it, and the wallet goes with it.",
    say: "The junk you win is its own near account. Coupons land in it every round. Sell it, and the wallet goes with it.",
    lead: 0.4,
    tail: 0.7,
  },
  {
    id: "money",
    text: "A thousand $TRASH is minted each round to whoever holds junk. Every winning bid is burned. Rich raccoons overbid, so the supply settles on its own.",
    say: "A thousand trash is minted each round, to whoever holds junk. Every winning bid is burned. Rich raccoons overbid, so the supply settles on its own.",
    lead: 0.5,
    tail: 0.9,
  },
  {
    id: "close",
    text: "One contract. No server. Junk Bonds, built at NEAR Hackathon.",
    say: "One contract. No server. Junk Bonds, built at near hackathon.",
    lead: 0.5,
    tail: 2.2,
  },
];
