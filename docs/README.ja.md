[English](../README.md) | [한국어](README.ko.md) | [中文](README.zh.md) | **日本語**

# QE Framework (Query Executor)

Claude Code向けの個人用スキル・エージェントパッケージ。

QE (Query Executor) は、ユーザーのクエリを構造化された実行可能なタスクに変換するフレームワークです。仕様生成から実装、検証、コミットまでのライフサイクル全体を、スキルとエージェントの連携システムによって管理します。

## 設計思想

QE Frameworkは、実証済みのエンジニアリング原則に基づいて構築されています：

- **SOLID** -- 単一責任、開放閉鎖、リスコフの置換、インターフェース分離、依存性逆転
- **DRY** -- ロジックの重複禁止。共通ロジックは共有コンポーネントに抽出
- **KISS** -- シンプルな解決策を優先。不要な複雑さを排除
- **YAGNI** -- 今必要なものだけを実装。投機的な設計はしない
- **エビデンスベース** -- 推測しない。不確実な場合はファイルを読んで検証する
- **最小変更** -- 要求された部分のみ変更。隣接コードのリファクタリングはしない
- **内部英語処理** -- すべての推論と分析は精度向上のため内部的に英語で行い、応答前にユーザーの言語に翻訳する。これにより、どの言語でも自然な会話を維持しながら、より良い結果を生み出す

## アーキテクチャ

QE Frameworkは3層アーキテクチャを採用しています：

```
Skills (Q-prefix)          Agents (E-prefix)          Core
方法論とプロセス            実行と委譲                 共有原則
/Qgenerate-spec            Etask-executor             PRINCIPLES.md
/Qsystematic-debugging     Ecode-debugger             INTENT_GATE.md
/Qcommit                   Ecommit-executor           AGENT_TIERS.md
```

- **Skills** は*どのように*行うかを定義（プロセス、方法論、ワークフローオーケストレーション）
- **Agents** は作業を*実行*（コーディング、デバッグ、レビュー、リサーチ）
- **Core** は共有原則、インテントルーティング、モデルティア選択を提供

## インストール

```bash
claude plugin add github:inho-team/qe-framework
```

### プロジェクトの初期化

```
/Qinit
```

`CLAUDE.md`、`.qe/` ディレクトリ構造を作成し、初期プロジェクト分析を実行します。

## 使い方

### タスクワークフロー

仕様を生成し、実行します：

```
/Qgenerate-spec    -- TASK_REQUEST.md + VERIFY_CHECKLIST.md を作成
/Qrun-task         -- 自動品質検証付きでタスクを実行
```

### 変更のコミット

```
/Qcommit           -- AI痕跡のない、人間らしいコミットを作成
```

### デバッグ

```
/Qsystematic-debugging   -- 修正適用前に根本原因を分析
```

### ディープリサーチ

技術比較、アーキテクチャ決定、調査タスクには `Edeep-researcher` エージェントを呼び出します。

### その他の例

```
/Qgenerate-spec + /Qrun-task     -- タスクの完全なライフサイクル
/Qfrontend-design                -- 本番品質のUIコンポーネントを作成
/Qtest-driven-development        -- レッド・グリーン・リファクタリングのTDDワークフロー
/Qgrad-paper-write               -- 学術論文の執筆
/Qc4-architecture                -- C4モデルアーキテクチャ図
/Qrefresh                        -- プロジェクト分析データを更新
```

## Skills (51)

### 開発

| スキル | 説明 |
|--------|------|
| Qcommit | 人間が書いたように見える自然なコミットを作成。AI痕跡を除去。 |
| Qsystematic-debugging | 体系的なデバッグで根本原因を特定し、仮説を検証してから修正。 |
| Qtest-driven-development | TDD：テストを先に書き、失敗を確認し、最小限のコードで通し、リファクタリング。 |
| Qcode-run-task | コードタスク完了後にテスト、レビュー、修正、再テストの品質検証ループを実行。 |
| Qfrontend-design | 高いデザイン品質を持つ、本番品質のフロントエンドインターフェースを作成。 |
| Qspringboot-security | Java Spring BootサービスのSpring Securityベストプラクティスガイド。 |
| Qdatabase-schema-designer | 正規化とインデックス戦略を備えた、堅牢でスケーラブルなSQL/NoSQLデータベーススキーマを設計。 |
| Qdoc-comment | プロジェクトの言語に適したドキュメントコメントを自動追加。 |
| Qmcp-builder | Python (FastMCP) またはTypeScript (MCP SDK) を使用したMCP (Model Context Protocol) サーバー作成ガイド。 |
| Qagent-browser | ナビゲーション、フォーム入力、スクリーンショット、データ抽出のためのブラウザ自動化CLI。 |

### タスク管理

| スキル | 説明 |
|--------|------|
| Qgenerate-spec | CLAUDE.md、TASK_REQUEST.md、VERIFY_CHECKLIST.md プロジェクト仕様書を生成。 |
| Qrun-task | TASK_REQUESTとVERIFY_CHECKLISTに基づき、自動検証付きでタスクを実行。 |
| Qinit | QEフレームワーク初期セットアップ：CLAUDE.md、設定、ディレクトリ構造の作成とプロジェクトの自動分析。 |
| Qrefresh | プロジェクト分析データを手動更新し、変更履歴を表示。 |
| Qresume | コンパクション後に保存されたコンテキストを復元し、前回の作業を再開。 |
| Qcompact | コンテキストの保存とセッション引き継ぎ。コンテキストを保存またはハンドオフ文書を生成。 |
| Qarchive | 完了したタスクファイルを自動アーカイブ。 |
| Qmigrate-tasks | 散在するタスクファイルを .qe/tasks/ と .qe/checklists/ ディレクトリ構造に移行。 |
| Qupdate | QE Frameworkプラグインを最新バージョンに更新。 |
| Qutopia | Utopiaモード -- 確認なしで完全自律実行。 |

### ドキュメント

| スキル | 説明 |
|--------|------|
| Qdocx | Wordドキュメント (.docx) の作成、読み取り、編集、操作。 |
| Qpdf | PDF関連の全タスク：読み取り、結合、分割、透かし、暗号化、OCRなど。 |
| Qpptx | PPTXの全タスク：スライドデッキの作成、読み取り、編集、テンプレート操作。 |
| Qxlsx | スプレッドシートの全タスク (.xlsx, .csv, .tsv)：数式、書式設定、チャート、データクリーニング。 |
| Qwriting-clearly | Strunkの原則に基づき、より明確で力強い文章を作成。 |
| Qhumanizer | テキストからAI生成の痕跡を除去。 |
| Qprofessional-communication | テクニカルコミュニケーションガイド：メール構成、チームメッセージ、会議アジェンダ。 |
| Qmermaid-diagrams | Mermaid構文を使用したソフトウェア図を生成（クラス図、シーケンス図、フローチャート、ERDなど）。 |
| Qc4-architecture | C4モデルのMermaid図を使用したアーキテクチャドキュメントを生成。 |
| Qimage-analyzer | 画像分析：スクリーンショット、図表、チャート、ワイヤーフレーム、OCRテキスト抽出。 |

### 学術

| スキル | 説明 |
|--------|------|
| Qgrad-paper-write | 標準的なセクション構成に従い、学術論文を体系的に執筆。 |
| Qgrad-paper-review | 査読者コメントを分析し、ポイントごとの回答を含むResponse Letterを作成。 |
| Qgrad-research-plan | ギャップ分析を伴う文献レビューと実験設計を実施。 |
| Qgrad-seminar-prep | スライド構成、スクリプト、想定Q&Aを含む学術プレゼンテーションを準備。 |
| Qgrad-thesis-manage | 論文進捗管理：章構成、進捗追跡、指導教員ミーティングの準備。 |

### プランニング

| スキル | 説明 |
|--------|------|
| Qpm-prd | 問題定義、ペルソナ、成功指標を含むPRDを体系的に作成。 |
| Qpm-user-story | Mike Cohn形式でGherkin受け入れ基準を持つユーザーストーリーを作成。 |
| Qpm-roadmap | 優先順位付けとリリース順序を含む戦略的プロダクトロードマップを計画。 |
| Qrequirements-clarity | 実装前に集中的な対話を通じて曖昧な要件を明確化。 |
| Qqa-test-planner | テスト計画、手動テストケース、回帰テストスイート、バグレポートを生成。 |

### メディア

| スキル | 説明 |
|--------|------|
| Qaudio-transcriber | 音声録音（MP3、WAV、M4Aなど）をプロフェッショナルなMarkdownドキュメントに変換。 |
| Qyoutube-transcript-api | YouTube動画の字幕・キャプションを抽出、文字起こし、翻訳。 |
| Qtranslate | 文法修正機能付き多言語翻訳。 |

### メタ

| スキル | 説明 |
|--------|------|
| Qskill-creator | 新規スキルの作成、既存スキルの変更、スキルパフォーマンスの測定。 |
| Qcommand-creator | 繰り返しワークフローからClaude Codeスラッシュコマンドを作成。 |
| Qfind-skills | skills.shでスキルを検索し、SKILL.mdファイルとしてインストール。 |
| Qalias | フォルダ、パス、コマンドの短縮名エイリアスを定義。 |
| Qprofile | ユーザーのコマンドパターン、文体、頻用表現を分析。 |
| Qagent-md-refactor | 肥大化したエージェント指示ファイルをプログレッシブディスクロージャーに従いリファクタリング。 |
| Qweb-design-guidelines | アクセシビリティとUXに関するWeb Interface Guidelinesに基づきUIコードをレビュー。 |
| Qlesson-learned | git履歴から最近のコード変更を分析し、エンジニアリングの教訓を抽出。 |

## Agents (16)

エージェントはタスクの複雑さに基づいてモデルティアが自動的に割り当てられます。詳細は [AGENT_TIERS.md](../core/AGENT_TIERS.md) を参照してください。

### HIGH ティア (opus)

| エージェント | 説明 |
|-------------|------|
| Edeep-researcher | 技術比較と意思決定支援のための体系的マルチステップリサーチエージェント。 |
| Eqa-orchestrator | テスト、レビュー、修正の完全な品質ループを実行。メインコンテキストを保護。 |

### MEDIUM ティア (sonnet)

| エージェント | 説明 |
|-------------|------|
| Etask-executor | チェックリスト項目を順番に実装。繰り返し作業のタスクパターンを学習。 |
| Ecode-debugger | デバッグ専門。バグの根本原因分析、エラー追跡、トラブルシューティング。 |
| Ecode-reviewer | コードレビュー専門。品質、セキュリティ、パフォーマンス、パターン準拠をレビュー。 |
| Ecode-test-engineer | テストエンジニア。テスト作成、カバレッジ分析、テスト戦略を担当。 |
| Ecode-doc-writer | テクニカルドキュメント専門。コード解説、APIドキュメント、READMEを作成。 |
| Edoc-generator | バッチドキュメント生成（docx/pdf/pptx/xlsx）用のバックグラウンドサブエージェント。 |
| Egrad-writer | 学術的な文体と引用規則で学術論文の章を執筆。 |
| Epm-planner | プランニング専門。PRD、ユーザーストーリー、ロードマップ、ドキュメント生成を担当。 |
| Erefresh-executor | プロジェクトの変更を検出し、.qe/ 分析データを更新し、変更履歴を記録。 |
| Ecompact-executor | コンテキストウィンドウの圧迫を検出し、コンテキストを保存し、コンパクション後の復元をサポート。 |
| Ehandoff-executor | セッションハンドオフ文書を生成・検証。 |

### LOW ティア (haiku)

| エージェント | 説明 |
|-------------|------|
| Earchive-executor | 完了したタスクファイルをバージョン別に .qe/.archive/ にアーカイブ。 |
| Ecommit-executor | 差分を分析し、コミットメッセージを生成し、AI痕跡なしでファイルをステージング。 |
| Eprofile-collector | ユーザーのコマンドパターン、文体、修正履歴を収集。 |

## プロジェクト構成

```
qe-framework/
├── .claude-plugin/    # プラグイン設定
├── agents/            # 16 agents (E-prefix)
├── skills/            # 51 skills (Q-prefix)
├── core/              # 共有原則と設定
├── hooks/             # ライフサイクルフック
├── install.js         # インストールスクリプト
└── package.json
```

## ライセンス

UNLICENSED
