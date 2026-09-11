#!/usr/bin/env bash
#
# install-global.sh — Instala a configuração global do OpenCode a partir do
# repositório core-brain (equivalente ao src/install-global.sh do taulukko;
# este repositório é a fonte open source dos plugins, incluindo o todo-list).
#
# Uso:
#   global/opencode/install-global.sh [-s ORIGEM] [-d DESTINO]
#
# Padrões:
#   ORIGEM  = <core-brain>/global/opencode
#   DESTINO = ~/.config/opencode
#
# Comportamento:
#   - Copia todo o conteúdo de ORIGEM para DESTINO (recursivamente)
#   - Preserva estrutura de diretórios
#   - Sobrescreve arquivos existentes silenciosamente
#   - Cria DESTINO se não existir
#   - Se ORIGEM não existir, exibe erro e sai imediatamente
#
# Nota: chamado pelo install-global.sh do taulukko quando a variável
# OESC_CORE_BRAIN_HOME aponta para este checkout (spec todo-list §10).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

DEFAULT_SRC="$SCRIPT_DIR"
DEFAULT_DST="$HOME/.config/opencode"

SRC="$DEFAULT_SRC"
DST="$DEFAULT_DST"

while getopts "s:d:h" opt; do
  case "$opt" in
    s) SRC="$OPTARG" ;;
    d) DST="$OPTARG" ;;
    h)
      echo "Uso: $0 [-s ORIGEM] [-d DESTINO]"
      echo ""
      echo "Instala configuração global do OpenCode a partir do core-brain."
      echo ""
      echo "Padrões:"
      echo "  ORIGEM  = $DEFAULT_SRC"
      echo "  DESTINO = $DEFAULT_DST"
      echo ""
      echo "Nota: ORIGEM deve existir; caso contrário o script aborta com erro."
      exit 0
      ;;
    *) exit 1 ;;
  esac
done

if [ ! -d "$SRC" ]; then
  echo "ERRO: Diretório de origem não encontrado: $SRC" >&2
  exit 1
fi

if [ ! -d "$SRC/plugins/todo-list" ]; then
  echo "AVISO: $SRC/plugins/todo-list não encontrado — rode todo-list/build.sh primeiro." >&2
fi

mkdir -p "$DST"

cp -r "$SRC/." "$DST/"

echo "Copiado de:  $SRC"
echo "Copiado para: $DST"
echo "Concluído com sucesso."
