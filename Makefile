# One-command workflows (md/manali/08 §6). Each target calls scripts/ops.mjs, which also runs
# without make: `node scripts/ops.mjs <target>` (Windows has no make by default).

OPS = node scripts/ops.mjs

.PHONY: install test abis deploy-local seed-local offline-state offline-build deploy-testnet \
        sim charts results-to-docs demo-offline demo-stop demo-status hooks

install:         ; $(OPS) install
test:            ; $(OPS) test
abis:            ; $(OPS) abis
deploy-local:    ; $(OPS) deploy-local
seed-local:      ; $(OPS) seed-local
offline-state:   ; $(OPS) offline-state
offline-build:   ; $(OPS) offline-build
deploy-testnet:  ; $(OPS) deploy-testnet
sim:             ; $(OPS) sim
charts:          ; $(OPS) charts
results-to-docs: ; $(OPS) results-to-docs
demo-offline:    ; $(OPS) demo-offline
demo-stop:       ; $(OPS) demo-stop
demo-status:     ; $(OPS) demo-status
hooks:           ; $(OPS) hooks
