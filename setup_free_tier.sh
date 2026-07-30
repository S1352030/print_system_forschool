#!/bin/bash
set -euo pipefail

if [ -z "$(swapon --show --noheadings)" ]; then
  sudo fallocate -l 1G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  if ! grep -q '^/swapfile ' /etc/fstab; then
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  fi
fi

echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-print-system.conf >/dev/null
sudo sysctl --system >/dev/null

if ! pm2 describe pm2-logrotate >/dev/null 2>&1; then
  pm2 install pm2-logrotate
fi
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
pm2 set pm2-logrotate:rotateInterval '0 0 * * *'

echo "Free Tier 主機設定完成：1 GB swap、swappiness=10、PM2 logrotate。"
