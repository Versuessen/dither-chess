/** The game about to start, handed from the bot profile panel to the game screen. */
import type { GameSetup } from '../chess/setup';

class Session {
  pending = $state<GameSetup | null>(null);
}

export const session = new Session();
