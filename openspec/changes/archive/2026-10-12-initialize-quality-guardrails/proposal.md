## Why

長期AI迭代已有PDF／禮物卡與快取測試，但缺少可攜架構規格、統一門檻、API／DB契約及CI。Changelog被忽略、Playwright依賴未鎖定、部署僅驗PDF，會令新對話遺失背景或漏掉高風險交易退化。

## What Changes

- 建立現況盤點、架構與六份主規格，保留歷史並解除Changelog忽略。
- 初始化OpenSpec1.14.1 Codex整合，建立AGENTS及標準局部修改／驗證／回復流程。
- 精確鎖定Playwright／dependency-cruiser，新增API與ORM契約、核心回歸、語法／依賴／紀錄檢查。
- 統一quality／health報告及CI／每週檢查；部署pytest涵蓋所有tests。

## Capabilities

### New Capabilities
- `architecture`: 實際模組邊界及防漂移。
- `print-orders`: 收件、計價、設定、歷史与Range基準。
- `gift-cards`: 實收、折抵、退款、冪等与帳目基準。
- `access-announcements`: 授權、限流与公告基準。
- `delivery-cache`: 建置、快取、壓縮及回復邊界。

### Modified Capabilities
- `quality-workflow`: 已建立主基準，完善完整門檻及報告要求。

## Impact

修改工具／文件／tests／package-lock／Git忽略与deploy檢查；不更改main、database、gift_cards等業務行為，不改API／資料格式，不執行正式部署或資料遷移。驗收需43既有Node、37既有pytest与新增核心測試、架構／OpenSpec strict、唯一版本build／壓縮／verify及Chromium／WebKit。穩定版本需另經提交、CI及必要正式驗收。
