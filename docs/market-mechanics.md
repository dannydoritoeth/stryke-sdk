# Market Mechanics

Stryke pilot markets ask whether BTC or SOL finishes strictly above an on-chain
strike. Equality resolves NO. Market state and resolution are authoritative
only when returned by Stryke; a locally observed Pyth price is an estimator
input, not proof of settlement.

Executable buy and sell quotes can change before transaction confirmation.
Clients must respect quote expiry, market-state version, minimum output, and
recent-blockhash validity.
