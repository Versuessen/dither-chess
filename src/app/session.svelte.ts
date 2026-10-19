/** The game about to start, handed from the bot profile panel to the game screen. */
import type { GameSetup } from '../chess/setup';

class Session {
  pending = $state<GameSetup | null>(null);
  /** Bumped to start a fresh game with the same setup ("Play again"). */
  gameNo = $state(0);
}

export const session = new Session();
