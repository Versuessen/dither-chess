/**
 * The roster. A persona is a name, an image and a level; every persona can be played with
 * any model that covers its level. The bio describes typical human play at that level on
 * Lichess rapid, which is what the models imitate. Nothing here changes how a bot plays.
 */

export interface Persona {
  id: string;
  /** Lichess rapid rating of the persona's level. */
  level: number;
  name: string;
  /** Subject texture in public/art. */
  subject: string;
  bio: string;
}

export const PERSONAS: readonly Persona[] = [
  {
    id: 'loose-ends',
    level: 600,
    name: 'Loose Ends',
    subject: 'pawn-crown',
    bio: 'Plays the first move that looks active. Hangs pieces most games, takes whatever you offer and keeps playing long after the position is lost.'
  },
  {
    id: 'early-queen',
    level: 700,
    name: 'Early Queen',
    subject: 'coronet',
    bio: 'Gets the queen out early and looks for quick mates. Punishes careless defence, then drifts once the opening is over.'
  },
  {
    id: 'hopscotch',
    level: 800,
    name: 'Hopscotch',
    subject: 'fork',
    bio: 'Spots knight forks some of the time and walks into them just as often. One-move threats get noticed; two-move threats rarely do.'
  },
  {
    id: 'back-rank',
    level: 900,
    name: 'Back Rank',
    subject: 'rook-crown',
    bio: 'Develops and castles, then forgets the king. Quiet positions go fine; the first sharp tactic usually decides the game.'
  },
  {
    id: 'coffeehouse',
    level: 1000,
    name: 'Coffeehouse',
    subject: 'board-rake',
    bio: 'Likes gambits and cheap traps. Wins material from players who move fast and gives it back to players who check twice.'
  },
  {
    id: 'long-diagonal',
    level: 1100,
    name: 'Long Diagonal',
    subject: 'mitre',
    bio: 'Sees two-move tactics and misses three-move ones. Bishops end up on long diagonals more by habit than by plan.'
  },
  {
    id: 'grinder',
    level: 1200,
    name: 'Grinder',
    subject: 'kings-cross',
    bio: 'Trades when unsure and heads for the endgame. Converts simple wins; complicated endgames still slip away.'
  },
  {
    id: 'pawn-storm',
    level: 1300,
    name: 'Pawn Storm',
    subject: 'pawn-chain',
    bio: 'Pushes pawns at your king when castled opposite. Opens files quickly, sometimes in front of its own king.'
  },
  {
    id: 'outpost',
    level: 1400,
    name: 'Outpost',
    subject: 'outpost',
    bio: 'Knows a good knight from a bad bishop. Makes fewer outright blunders; loses to deeper tactics and time trouble.'
  },
  {
    id: 'swindler',
    level: 1500,
    name: 'Swindler',
    subject: 'toppled-king',
    bio: 'Defends worse positions stubbornly and sets traps when behind. Expect to have to win a won game twice.'
  },
  {
    id: 'tempo',
    level: 1600,
    name: 'Tempo',
    subject: 'knight-profile',
    bio: 'Develops quickly and punishes slow openings. Plans in the middlegame are real but short.'
  },
  {
    id: 'promotion',
    level: 1700,
    name: 'Promotion',
    subject: 'queen-tower',
    bio: 'Knows the basic endgames and pushes passed pawns with purpose. Calculates a few moves deep most of the time.'
  },
  {
    id: 'opposition',
    level: 1800,
    name: 'Opposition',
    subject: 'king-queen',
    bio: 'Rarely blunders outright and steers toward endgames it understands. Mostly loses to longer plans.'
  },
  {
    id: 'citadel',
    level: 1900,
    name: 'Citadel',
    subject: 'citadel',
    bio: 'Patient and hard to break. Takes few risks and leaves it to you to find the plan.'
  }
];

export const HOME_SUBJECT = 'hero';

export function personaById(id: string): Persona | undefined {
  return PERSONAS.find((p) => p.id === id);
}
