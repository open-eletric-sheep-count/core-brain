#!/usr/bin/env bash
#
# install-vars.sh — grava no ambiente do usuário a variável que localiza este
# checkout do core-brain (spec todo-list §10).
#
#   OESC_CORE_BRAIN_HOME — caminho absoluto do repositório core-brain
#
# Valor padrão: detectado a partir da localização deste script
# (<core-brain>/global/opencode/install-vars.sh → <core-brain>); pode ser
# sobrescrito exportando OESC_CORE_BRAIN_HOME antes de rodar.
#
# Grava em:
#   - /etc/environment (quando gravável; âmbito do sistema)
#   - ~/.bashrc (bloco com marcador; fallback do usuário, reexecutável sem
#     duplicar — o bloco antigo é substituído)
#
# O install-global.sh do taulukko usa OESC_CORE_BRAIN_HOME para chamar o
# install-global.sh deste repositório.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DETECTED="$(dirname "$(dirname "$SCRIPT_DIR")")"
VALUE="${OESC_CORE_BRAIN_HOME:-$DETECTED}"
VAR="OESC_CORE_BRAIN_HOME"

write_env_file() {
  local file="$1"
  [ -f "$file" ] || return 0
  touch "$file" 2>/dev/null || return 1
  if grep -q "^${VAR}=" "$file" 2>/dev/null; then
    local tmp="${file}.oesc-tmp"
    sed "s|^${VAR}=.*|${VAR}=${VALUE}|" "$file" > "$tmp" && mv "$tmp" "$file"
  else
    printf '%s=%s\n' "$VAR" "$VALUE" >> "$file"
  fi
}

if [ -w /etc/environment ]; then
  if write_env_file /etc/environment; then
    echo "Gravado em /etc/environment: $VAR=$VALUE"
  else
    echo "AVISO: falha ao gravar /etc/environment — usando apenas ~/.bashrc" >&2
  fi
else
  echo "AVISO: /etc/environment não gravável — usando apenas ~/.bashrc" >&2
fi

BASHRC="$HOME/.bashrc"
BEGIN="# >>> oesc/core-brain install-vars >>>"
END="# <<< oesc/core-brain install-vars <<<"

if [ -f "$BASHRC" ] && grep -qF "$BEGIN" "$BASHRC" 2>/dev/null; then
  awk -v b="$BEGIN" -v e="$END" '
    $0 == b { skip = 1; next }
    $0 == e { skip = 0; next }
    !skip { print }
  ' "$BASHRC" > "$BASHRC.oesc-tmp" && mv "$BASHRC.oesc-tmp" "$BASHRC"
fi

printf '\n%s\nexport %s=%s\n%s\n' "$BEGIN" "$VAR" "$VALUE" "$END" >> "$BASHRC"

echo "Gravado em $BASHRC: export $VAR=$VALUE"
echo "Concluído com sucesso."
