# ONNX parity

Criteria: top-1 agreement >= 99.9% and max |logit difference| < 0.001 over the full vocabulary.

| Model | Positions | Top-1 agreement | Max abs logit diff | (legal moves) | Max abs value diff | Result |
|---|---|---|---|---|---|---|
| fastelo | 2016 | 100.00% | 2.05e-05 | 1.57e-05 | 4.53e-06 | pass |
| maia3-5m | 2016 | 100.00% | 2.19e-05 | 1.34e-05 | 2.86e-06 | pass |
| maia3-23m | 2016 | 100.00% | 2.67e-05 | 2.29e-05 | 2.86e-06 | pass |
| maia2-rapid | 2016 | 100.00% | 0.00e+00 | 0.00e+00 | 0.00e+00 | pass |
