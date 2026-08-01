# SDK And Reference-Bot Terminology

This file defines strategy terms used by the external SDK and reference bot.

| Term | Meaning |
| --- | --- |
| Polymarket-relative edge | The difference between the conservative Polymarket probability for one side and that side's Stryke effective executable cost probability for the configured trade. It is not a comparison with the unsized display probability. |
| Early relative-value strategy | A strategy that may enter only during a bounded window after the aligned market interval opens. It may hold to expiry or exit under an explicitly configured policy. Public shorthand: early sniper. |
| Late relative-value strategy | A strategy that evaluates once during a bounded window before the first closing-fee tier begins and, if it enters, holds to expiry by default. Public shorthand: late sniper. |
| Effective executable cost probability | Total collateral debited for the proposed buy divided by the API-authored projected Winning Payout after that buy, expressed in basis points. |
| Hold expected value | Conservative reference probability multiplied by projected Winning Payout, less total collateral debited. It is a snapshot estimate, not a guaranteed return. |
| Closing-fee onset | The authoritative timestamp at which the first closing-fee tier starts for a market. It is distinct from the hard-lock timestamp. |
| Submission safety buffer | The minimum time reserved before closing-fee onset for reference retrieval, quoting, preparation, wallet approval, submission and confirmation. |
| Exit policy | The configured rule governing an early-strategy position: `hold_to_expiry`, `exit_on_convergence`, or `risk_managed`. |

The SDK and bot must continue to use the API-authored terms **Current Value**
and **Winning Payout**. They must not derive either value from aggregate pool
totals or use virtual liquidity as realizable collateral.
