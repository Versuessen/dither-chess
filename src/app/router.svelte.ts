/** Hash router. Hash routing works the same on a static host, offline, and in Tauri. */

export type Route =
  | { name: 'home' }
  | { name: 'bot'; persona: string }
  | { name: 'game' }
  | { name: 'history' }
  | { name: 'analysis'; game: string }
  | { name: 'rating' }
  | { name: 'models' }
  | { name: 'settings' }
  | { name: 'puzzles' };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '').replace(/^\/+/, '');
  const [head = '', arg] = path.split('/');
  switch (head) {
    case 'bot':
      return arg ? { name: 'bot', persona: decodeURIComponent(arg) } : { name: 'home' };
    case 'analysis':
      return arg ? { name: 'analysis', game: decodeURIComponent(arg) } : { name: 'history' };
    case 'game':
    case 'history':
    case 'rating':
    case 'models':
    case 'settings':
    case 'puzzles':
      return { name: head };
    default:
      return { name: 'home' };
  }
}

export function href(route: Route): string {
  switch (route.name) {
    case 'home':
      return '#/';
    case 'bot':
      return `#/bot/${encodeURIComponent(route.persona)}`;
    case 'analysis':
      return `#/analysis/${encodeURIComponent(route.game)}`;
    default:
      return `#/${route.name}`;
  }
}

class Router {
  route = $state<Route>(parseRoute(typeof location === 'undefined' ? '' : location.hash));

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('hashchange', () => {
        this.route = parseRoute(location.hash);
      });
    }
  }

  go(route: Route, replace = false): void {
    const target = href(route);
    if (replace) history.replaceState(null, '', target);
    else if (location.hash !== target) location.hash = target;
    this.route = route;
  }
}

export const router = new Router();
