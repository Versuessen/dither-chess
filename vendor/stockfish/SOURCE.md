# Stockfish (game analysis only)

`stockfish-19-lite-single.js` and `stockfish-19-lite-single.wasm` are copied unchanged from the npm
package [`stockfish@19.0.0`](https://www.npmjs.com/package/stockfish/v/19.0.0) (Stockfish.js by
Nathan Rugg for Chess.com, built from [Stockfish](https://github.com/official-stockfish/Stockfish) 19
with the small "lite" network). Licence: GPL-3.0 (`Copying.txt`); source:
https://github.com/nmrugg/stockfish.js and https://github.com/official-stockfish/Stockfish.

| file | SHA-256 |
| --- | --- |
| stockfish-19-lite-single.js | d3344124ab067fb0b90ee77873bb8e9fbf5fc01bc525fe714b0f942581e889e6 |
| stockfish-19-lite-single.wasm | 57ac2d72312aba346760e3f173f687a8c211208e97a87268436f7f0e10bb5387 |

DITHER runs it in a Web Worker to review finished games (src/analysis). It never plays against
you: the opponents are the neural move-prediction models only.
