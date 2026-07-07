# QE Framework ドキュメント案内

> 📖 **ブラウザで今すぐ見る**: [入門 Intro →](https://inho-team.github.io/qe-framework/qe_framework_intro.ja.html) · [全体 Reference →](https://inho-team.github.io/qe-framework/qe_framework_diagram.ja.html)
>
> **他の言語**: [English](https://inho-team.github.io/qe-framework/qe_framework_intro.en.html) · [한국어](https://inho-team.github.io/qe-framework/qe_framework_intro.ko.html) · [中文](https://inho-team.github.io/qe-framework/qe_framework_intro.zh.html)

QE Framework は Claude Code と Codex の両方を対象にしたスペック駆動タスク実行フレームワークです。25+ のエージェント、183+ のスキル、27 のライフサイクルフックで、完全にカスタマイズ可能なタスク自動化とワークフロー実行を実現します。

基本フロー:

```text
Claude: /Qplan -> /Qgs -> /Qexecute -> /Qexecute -verify
Codex:  $Qplan -> $Qgs -> $Qexecute -> $Qexecute -verify
```

この文書は日本語のランディングページです。詳細は役割ごとに分割された文書を参照してください。

## v7.0 新機能

- **27 のライフサイクルフック**: Claude Code 完全カバレッジで、セッション、タスク、ツール実行の全フェーズを監視・制御
- **effort パラメータと Compaction API**: 計算リソースを効率的に管理し、大規模タスク実行を最適化
- **スキルバジェット自動管理**: デプロイ時にスキル使用量を自動監視し、割り当て超過を防止
- **ハーネスエンジニアリングメトリクス 6 種**: レイテンシ、トークン消費、成功率、エージェント効率、フック実行時間、タスク完了率を統合トラッキング
- **Agent Teams と Dynamic Workflows**: 複数のエージェントを動的に組成し、複雑なマルチステップ実行を並列化

## まず読む文書

- プロジェクト概要: [../README.md](../README.md)
- 哲学と設計意図: [PHILOSOPHY.md](PHILOSOPHY.md)
- 詳細な使い方: [USAGE_GUIDE.md](USAGE_GUIDE.md)
- 文書マップ: [DOCUMENTATION_MAP.md](DOCUMENTATION_MAP.md)
- マルチモデル設定: [MULTI_MODEL_SETUP.md](MULTI_MODEL_SETUP.md)
- システム概要: [SYSTEM_OVERVIEW.md](SYSTEM_OVERVIEW.md)

## 核心概念

- `single-model`
  - Claude のみを使う基本経路
  - `/Qexecute` は Haiku swarm ベースの atomic execution
- `hybrid`
  - 一部の役割だけ外部 runner を使う
- `multi-model`
  - planner / implementer / reviewer / supervisor を役割ごとに明示的に分離する
- `tiered-model`
  - 同じ provider の中で難易度に応じて上位・中位・下位モデルを分けて使う

## サブスクリプション構成ごとの推奨

| 利用可能なツール | 推奨モード | 推奨デフォルト割り当て |
|------------------|------------|------------------------|
| Claude のみ | `single-model` | Claude が全役割を担当 |
| Claude tiered | `tiered-model` | planner/supervisor = Opus、implementer/reviewer = Sonnet、軽量補助 = Haiku |
| Codex tiered | `tiered-model` | planner/supervisor = GPT-5.4、implementer/reviewer = GPT-5-Codex、軽量補助 = GPT-5-Codex-Mini |
| Claude + Codex | `hybrid` | implementer = Codex、その他 = Claude |
| Claude + Gemini | `hybrid` | reviewer = Gemini、その他 = Claude |
| Claude + Codex + Gemini | `multi-model` | planner/supervisor = Claude、implementer = Codex、reviewer = Gemini |

## クイックスタート

1. プラグインをインストール

```bash
claude plugin marketplace add inho-team/qe-framework
claude plugin install qe-framework@inho-team-qe-framework
```

インストールは **dual-target** で、Claude と Codex の両方にインストールします。

- **Claude**: skill・agent・core・hooks・scripts を `~/.claude` に。
- **Codex**（`~/.codex` がある場合）: skill→`~/.codex/skills`、agent→`~/.codex/agents/*.toml`、
  `~/.codex/config.toml` に agent fence と `[[hooks.PreToolUse]]` セーフティフック fence。
  Codex 非ユーザー（`~/.codex` 不在）は静かにスキップ。インストール後に Codex で `/hooks` を実行しフックを一度承認します。

**正直な上限**: ✅ インストールとセーフティガード（raw git commit・gh pr create・sed -i・plugin.json の
直接バージョン書き込みのブロック）は Claude と完全に同一。⚠️ E-agent へ委譲する skill は Codex 上で
**インライン降格**（Codex は明示的な `/agent` 時のみサブエージェントを spawn、自動委譲なし）。
SIVS ステージを Codex **エンジン**へルーティングするのも `codex-plugin-cc`+`/Qsivs-config` で可能。

> `qe-framework-uninstall` は Claude 資産を、`--purge-codex` 付きなら Codex 資産も削除します
> （デフォルトは dry-run 報告のみ、QE 以外の資産は保持）。

2. プロジェクトを初期化

```text
/Qinit
```

Codex では次のように skill 名で呼び出せます。

```text
$Qinit
```

3. ワークフローを開始

```text
Claude: /Qplan -> /Qgs -> /Qexecute -> /Qexecute -verify
Codex:  $Qplan -> $Qgs -> $Qexecute -> $Qexecute -verify
```

## 参考

- quota 制限で runner が使えない場合は `--role-override` で一時的に再割り当てします。
- この override は現在の実行だけに適用され、`team-config.json` は書き換えません。

## ⚠️ 自律実行モード (`/Qutopia` / `$Qutopia`)

`Qutopia` は **すべての確認プロンプトをスキップ** して自動で進行させるセッションスイッチです。Claude では `/Qutopia`、Codex では `$Qutopia` を使います。作業は速くなりますが、誤ったファイルのコミットや `main` への直接 push といったリスクも伴います。

**有効化前の必須チェック**:
1. 要件が明確か（アトミックな checklist あり）
2. すべてのステップがロールバック可能か（force-push・マイグレーション・破壊的削除なし）
3. working tree がクリーンか（無関係な変更が混入していない）
4. 共有ブランチ（`main`/`master`）ではないか
5. 自動コミット・自動イテレーションを許容できるか

全ガイドと ON/OFF の推奨パターンは [USAGE_GUIDE.md §10](USAGE_GUIDE.md#10-autonomous-mode-qutopia--%EF%B8%8F-read-before-enabling) を参照してください。**セッション終了前に Claude は `/Qutopia off`、Codex は `$Qutopia off` を実行**してください。
