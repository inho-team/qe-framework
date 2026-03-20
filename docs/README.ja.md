<div align="center">

<br/>

# QE Framework

### Claude Code向けのスペック駆動タスク実行フレームワーク

![Stars](https://img.shields.io/github/stars/inho-team/qe-framework?style=social)
![Release](https://img.shields.io/github/v/release/inho-team/qe-framework?style=flat&logo=github&color=8B5CF6)
![Last Commit](https://img.shields.io/github/last-commit/inho-team/qe-framework?style=flat&logo=git&color=22C55E)

[![Built with Claude](https://img.shields.io/badge/Built_with-Claude-D4A574?style=flat&logo=anthropic&logoColor=white)](https://claude.ai)
[![65 Skills](https://img.shields.io/badge/Skills-65-8B5CF6?style=flat)](#skills-65--72-coding-experts)
[![72 Coding Experts](https://img.shields.io/badge/Coding_Experts-72-EC4899?style=flat)](#coding-expert-skills-72)
[![22 Agents](https://img.shields.io/badge/Agents-22-F97316?style=flat)](#agents-22)

<br/>

[English](../README.md) | [한국어](README.ko.md) | [中文](README.zh.md) | **日本語**

</div>

---

> [!IMPORTANT]
> **QE Framework v2.1.0** — Haiku翻訳レイヤーによるi18nインテントルーティングを追加。非英語メッセージが自動的に英語キーワードに翻訳されスキルマッチングに使用されます。

---

## 設計思想

> 仕様のない作業は推測である。
> 検証のない仕様は希望である。
> 監理のない検証は確証バイアスである。

QE Frameworkは**SVSループ**（Spec → Verify → Supervise）を中心に構築されています：

```
/Qgenerate-spec  →  /Qrun-task  →  Supervision  →  Done
                                        ↑                |
                           auto-remediate (max 3x)  ← FAIL
```

1. **`/Qgenerate-spec`** -- TASK_REQUEST + VERIFY_CHECKLISTを作成。Planエージェントが自動的に仕様をレビューします。実行可能性の検証により、すべての項目がアクション可能であることを保証します。
2. **`/Qrun-task`** -- チェックリスト項目を進捗追跡付きで順次実行。タスクタイプバナー（CODE/DOCS/ANALYSIS）を表示し、承認前に何が起こるかを正確に把握できます。
3. **Supervision** -- ドメイン別の監理エージェント（コード品質、セキュリティ、ドキュメント、分析）が独立したレビューを実施。不合格の場合、REMEDIATION_REQUESTが自動生成され、ループが再実行されます -- 人間の介入なしで最大3回まで。
4. **最小限の中断** -- 確認が求められるのは5つのポイントのみ：仕様確認、実行プロンプト、タスク承認、完了報告、3回の監理失敗時のエスカレーション。それ以外はすべて自動です。

エンジニアリング原則：SOLID、DRY、KISS、YAGNI、エビデンスベースの意思決定、最小変更、多言語対応（自動言語検出）。

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

以下のコマンドは**ターミナル**で実行してください（Claude Codeセッション内ではありません）：

### ステップ1：マーケットプレイスの登録（初回のみ）
```bash
claude plugin marketplace add inho-team/qe-framework
```

### ステップ2：プラグインのインストール
```bash
claude plugin install qe-framework@inho-team-qe-framework
```

### 最新バージョンへの更新
```bash
claude plugin update qe-framework@inho-team-qe-framework
```

### インストールの確認
```bash
claude plugin list
```

### トラブルシューティング

**インストール時のSSH権限拒否エラー**

`git@github.com: Permission denied (publickey)` が表示された場合、以下のコマンドでHTTPSを強制してください：
```bash
git config --global url."https://github.com/".insteadOf "git@github.com:"
```
その後、インストールコマンドを再実行してください。

> **Note**: プラグインコマンドはターミナルでのみ実行できます。Claude Codeセッション内では実行できません。インストールまたは更新後、Claude Codeを再起動して変更を適用してください。

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

## Skills (65 + 72 Coding Experts)

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
| Qautoresearch | Karpathyのautoresearchに着想を得た自律実験ループ。コード変更を繰り返し、メトリクスを評価し、keep/discardを判定。マルチファイル対応、Ecode-reviewer/debugger統合。 |
| Qmcp-setup | MCPサーバーの設定・接続セットアップガイド。settings.json生成、接続テスト、トラブルシューティング。 |
| Qstitch-cli | Google Stitch MCPセットアップとCLIガイド。AI駆動UIデザイン用。 |
| Qcc-setup | Claude Codeシェルエイリアスセットアップ（cc、ccc、ccd）。ターミナルからの素早い起動用。 |

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
| Qdoc-converter | MD、DOCX、PDF、PPTX、HTML間のドキュメント形式変換。マルチツールオーケストレーション対応。 |
| Qcontent-research-writer | 引用、反復改善、セクション別フィードバックを含むリサーチ駆動コンテンツ作成。 |

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
| Qhelp | QE Frameworkクイックリファレンスカードをターミナルに表示。 |
| Qskill-tester | 自動スキルルーティングテスター。インテント分類の精度を検証し、誤分類スキルを検出。 |
| Qjira-cli | MCPサーバー設定不要の軽量Jira CLIラッパー。クイックイシュー管理用。 |

### 分析

| スキル | 説明 |
|--------|------|
| Qdata-analysis | CSV/JSON/Excelデータセットのデータ探索、統計分析、可視化。 |
| Qfinance-analyst | 財務分析、バリュエーションモデリング、DCF、モンテカルロシミュレーション、ポートフォリオ最適化。 |
| Qfact-checker | ドキュメントから事実の主張を抽出し、エビデンスベースのリサーチで検証。 |
| Qsource-verifier | SIFTメソッドを使用してソースの信頼性とデジタルコンテンツの真正性を検証。 |

## Coding Expert Skills (72)

ドメイン別のコーディング専門スキル。各スキルは対象技術スタックについての深い専門知識を提供し、ベストプラクティス、一般的なパターン、プロダクション品質のコード生成を含みます。

### Languages (14)

| スキル | 説明 |
|--------|------|
| Qcpp-pro | concepts、ranges、コルーチン、SIMD、テンプレートメタプログラミングを活用したモダンC++20/23。 |
| Qcsharp-developer | .NET 8+、ASP.NET Core、Blazor、Entity Framework、CQRSパターンのC#開発。 |
| Qembedded-systems | STM32、ESP32、FreeRTOS、ベアメタル、リアルタイムシステム用ファームウェア。 |
| Qgolang | 厳格なテスト駆動開発と品質ゲートを備えたGo開発標準。 |
| Qgolang-pro | 並行Goパターン、gRPC/RESTマイクロサービス、パフォーマンス最適化。 |
| Qjava-architect | Spring Boot 3.x、WebFlux、JPA最適化、OAuth2/JWTセキュリティ。 |
| Qjavascript-pro | モダンES2023+、async/await、ESMモジュール、Node.js API。 |
| Qkotlin-specialist | コルーチン、Flow、KMP、Compose UI、Ktor、型安全DSL。 |
| Qphp-pro | Laravel、Symfony、Swoole非同期、PSR標準を活用したPHP 8.3+。 |
| Qpython-pro | 型安全性、非同期プログラミング、pytest、mypy strictモードのPython 3.11+。 |
| Qrust-engineer | 所有権、ライフタイム、トレイト、tokio非同期、ゼロコスト抽象化。 |
| Qsql-pro | 複雑なクエリ、ウィンドウ関数、CTE、インデックス、クロスダイアレクトマイグレーション。 |
| Qswift-expert | SwiftUI、async/await、アクター、プロトコル指向設計のiOS/macOS開発。 |
| Qtypescript-pro | 高度なジェネリクス、条件型、ブランド型、tRPC統合。 |

### Frontend (12)

| スキル | 説明 |
|--------|------|
| Qangular-architect | Angular 17+スタンドアロンコンポーネント、NgRx、RxJSパターン、遅延ローディング。 |
| Qflutter-expert | Riverpod/Bloc、GoRouter、プラットフォーム別実装のFlutter 3+。 |
| Qgame-developer | Unity/Unreal Engine、ECSアーキテクチャ、マルチプレイヤーネットワーキング、シェーダープログラミング。 |
| Qnextjs-developer | Next.js 14+ App Router、Server Components、Server Actions、ストリーミングSSR。 |
| Qreact-best-practices | Vercel EngineeringによるReact/Next.jsパフォーマンス最適化ガイドライン。 |
| Qreact-expert | フック、Server Components、Suspense、React 19機能を活用したReact 18+。 |
| Qreact-native-expert | React Native、Expo、ネイティブモジュール統合のクロスプラットフォームモバイルアプリ。 |
| Qvite | Viteビルドツール設定、プラグインAPI、SSR、Rolldownマイグレーション。 |
| Qvue-best-practices | TypeScript、SSR、Volarを活用したVue 3 Composition API。 |
| Qvue-expert | Vue 3 Composition API、Nuxt 3、Pinia、Quasar/Capacitor、PWA機能。 |
| Qvue-expert-js | バニラJavaScriptとJSDocベースのタイピングによるVue 3（TypeScriptなし）。 |
| Qweb-design-guidelines-vercel | Web Interface Guidelines準拠のUIコードレビュー。 |

### Backend (14)

| スキル | 説明 |
|--------|------|
| Qapi-designer | REST/GraphQL API設計、OpenAPIスペック、バージョニング、ページネーションパターン。 |
| Qarchitecture-designer | システムアーキテクチャ、ADR、技術トレードオフ、スケーラビリティ計画。 |
| Qdjango-expert | Django REST Framework、ORM最適化、JWT認証。 |
| Qdotnet-core-expert | .NET 8ミニマルAPI、クリーンアーキテクチャ、クラウドネイティブマイクロサービス。 |
| Qfastapi-expert | Pydantic V2とSQLAlchemyを活用した高性能非同期Python API。 |
| Qgraphql-architect | GraphQLスキーマ、Apollo Federation、DataLoader、リアルタイムサブスクリプション。 |
| Qlaravel-specialist | Eloquent、Sanctum、Horizon、Livewire、Pestテストを活用したLaravel 10+。 |
| Qlegacy-modernizer | Strangler figパターン、branch by abstraction、段階的マイグレーション。 |
| Qmcp-developer | TypeScriptまたはPython SDKを活用したMCPサーバー/クライアント開発。 |
| Qmicroservices-architect | DDD、サガパターン、イベントソーシング、CQRS、サービスメッシュ、分散トレーシング。 |
| Qnestjs-expert | NestJSモジュール、依存性注入、ガード、インターセプター、Swaggerドキュメント。 |
| Qrails-expert | Hotwire、Turbo Frames/Streams、Action Cable、SidekiqのRails 7+。 |
| Qspring-boot-engineer | Spring Boot 3.x REST、Spring Security 6、Spring Data JPA、WebFlux。 |
| Qwebsocket-engineer | Redisスケーリングとプレゼンス追跡を備えたリアルタイムWebSocket/Socket.IOシステム。 |

### Data & AI (6)

| スキル | 説明 |
|--------|------|
| Qfine-tuning-expert | LoRA/QLoRA、PEFT、インストラクションチューニング、RLHF、DPO、モデル量子化。 |
| Qml-pipeline | MLflow、Kubeflow、Airflow、フィーチャーストア、実験追跡。 |
| Qpandas-pro | DataFrame操作、集計、マージ、時系列、パフォーマンス最適化。 |
| Qprompt-engineer | プロンプト設計、思考連鎖、フューショット学習、評価フレームワーク。 |
| Qrag-architect | RAGシステム、ベクターデータベース、ハイブリッド検索、リランキング、エンベディングパイプライン。 |
| Qspark-engineer | Spark DataFrame変換、SQL最適化、構造化ストリーミング。 |

### Infra & DevOps (14)

| スキル | 説明 |
|--------|------|
| Qatlassian-mcp | MCPによるJira/Confluence統合、課題追跡とドキュメント管理。 |
| Qchaos-engineer | カオス実験、障害注入、ゲームデー、レジリエンステスト。 |
| Qcli-developer | 引数パース、補完、対話型プロンプトを備えたCLIツール。 |
| Qcloud-architect | マルチクラウドアーキテクチャ、Well-Architected Framework、コスト最適化。 |
| Qdatabase-optimizer | クエリ最適化、EXPLAIN分析、インデックス設計、パーティショニング戦略。 |
| Qdevops-engineer | Docker、CI/CD、Kubernetes、Terraform、GitHub Actions、GitOps。 |
| Qkubernetes-specialist | K8sマニフェスト、Helmチャート、RBAC、NetworkPolicies、マルチクラスター管理。 |
| Qmonitoring-expert | Prometheus/Grafana、構造化ロギング、アラート、分散トレーシング、負荷テスト。 |
| Qpostgres-pro | PostgreSQL EXPLAIN、JSONB、拡張機能、VACUUMチューニング、レプリケーション。 |
| Qsalesforce-developer | Apex、Lightning Web Components、SOQL、トリガー、プラットフォームイベント。 |
| Qshopify-expert | Liquidテーマ、Hydrogenストアフロント、Shopifyアプリ、チェックアウト拡張。 |
| Qsre-engineer | SLI/SLO、エラーバジェット、インシデント対応、カオスエンジニアリング、キャパシティプランニング。 |
| Qterraform-engineer | Terraformモジュール、状態管理、マルチ環境ワークフロー、テスト。 |
| Qwordpress-pro | WordPressテーマ、Gutenbergブロック、WooCommerce、REST API、セキュリティ強化。 |

### Quality & Security (12)

| スキル | 説明 |
|--------|------|
| Qcode-documenter | ドキュメント文字列、OpenAPI/Swaggerスペック、JSDoc、ドキュメントポータル。 |
| Qcode-reviewer | コード品質監査：バグ、セキュリティ、パフォーマンス、命名、アーキテクチャ。 |
| Qdebugging-wizard | エラーパース、スタックトレース分析、仮説駆動型の根本原因特定。 |
| Qfeature-forge | 要件ワークショップ、ユーザーストーリー、EARS形式スペック、受け入れ基準。 |
| Qfullstack-guardian | 多層認証とバリデーションを備えたセキュリティ重視のフルスタック開発。 |
| Qplaywright-expert | PlaywrightによるE2Eテスト、ページオブジェクト、フィクスチャー、ビジュアルリグレッション。 |
| Qsecure-code-guardian | 認証、入力バリデーション、OWASP Top 10防止、暗号化。 |
| Qsecurity-reviewer | セキュリティ監査、SAST、ペネトレーションテスト、コンプライアンスチェック。 |
| Qspec-miner | レガシー/未ドキュメントコードベースからのリバースエンジニアリングスペック抽出。 |
| Qtest-master | テスト戦略、カバレッジ分析、パフォーマンステスト、テストアーキテクチャ。 |
| Qthe-fool | 悪魔の代弁者、プリモーテム、レッドチーミング、仮定の監査。 |
| Qvitest | Jest互換API、モッキング、カバレッジを備えたVitestユニットテスト。 |

## バックグラウンド処理

QE Frameworkは、ライフサイクルの重要なタイミングで複数のエージェントをバックグラウンドで自動実行します。これらのエージェントは手動で呼び出す必要はなく、フックや他のエージェントによって自動的にトリガーされます。

### 仕組み

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        QE Framework Lifecycle                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  Session Start                                                        │
│  ┌──────────────┐    ┌─────────────────────┐                          │
│  │ SessionStart │───▶│ Erefresh-executor   │  Update .qe/analysis/    │
│  │    Hook      │    │ (if analysis stale) │  before any work begins  │
│  └──────────────┘    └─────────────────────┘                          │
│         │                                                             │
│         ▼                                                             │
│  User Interaction                                                     │
│  ┌──────────────┐    ┌─────────────────────┐                          │
│  │ PreToolUse   │───▶│   Intent Gate       │  Route user intent to    │
│  │    Hook      │    │   Classification    │  the correct skill/agent │
│  └──────────────┘    └─────────────────────┘                          │
│         │                                                             │
│         ▼                                                             │
│  ┌──────────────┐    ┌─────────────────────┐                          │
│  │ PostToolUse  │───▶│ Eprofile-collector  │  Learn user patterns     │
│  │    Hook      │    │ (command, style)    │  and correction history  │
│  └──────────────┘    └─────────────────────┘                          │
│         │                                                             │
│         ▼                                                             │
│  Context Pressure (75%+)                                              │
│  ┌──────────────┐    ┌─────────────────────┐                          │
│  │ PreCompact   │───▶│ Ecompact-executor   │  Save snapshot before    │
│  │    Hook      │    │ (auto-save context) │  context is lost         │
│  └──────────────┘    └─────────────────────┘                          │
│         │                                                             │
│         ▼                                                             │
│  Task Completion                                                      │
│  ┌──────────────┐    ┌─────────────────────┐                          │
│  │  Qrun-task   │───▶│ Earchive-executor   │  Archive completed tasks │
│  │  completes   │    │ Ecommit-executor    │  Auto-commit changes     │
│  └──────────────┘    └─────────────────────┘                          │
│         │                                                             │
│         ▼                                                             │
│  ┌──────────────┐    ┌─────────────────────┐                          │
│  │ Notification │───▶│  Chain follow-up    │  Trigger next actions    │
│  │    Hook      │    │  actions            │  when agents complete    │
│  └──────────────┘    └─────────────────────┘                          │
│                                                                       │
└─────────────────────────────────────────────────────────────────────────┘
```

### ライフサイクルフック

フレームワークは特定のイベントで発火する9つのライフサイクルフックを使用します：

| フック | トリガー | 動作内容 |
|--------|----------|----------|
| `SessionStart` | 会話の開始時 | フレームワークルールを注入し、分析データが古い場合は `Erefresh-executor` をトリガー |
| `UserPromptSubmit` | ユーザーがメッセージを送信した時 | CJK/bigramインテント自動分類 + **言語検出** (`.qe/profile/language.md`に保存) |
| `PreToolUse` | すべてのツール呼び出しの前 | Intent Gateルーティング表示、シークレットスキャン、コンテキスト圧迫警告 |
| `PostToolUse` | すべてのツール呼び出しの後 | エラー追跡・エスカレーション、ツール呼び出しカウント、`Eprofile-collector` トリガー |
| `PreCompact` | コンテキストコンパクションの前 | `Ecompact-executor` をトリガーしてコンテキストが失われる前に保存 |
| `Stop` | 会話の終了時 | セッションログ記録、アクティブ作業中のモードブロック |
| `Notification` | バックグラウンドエージェントの完了時 | バックグラウンドエージェント完了後にフォローアップアクションをチェーン |
| `TaskCompleted` | タスクが完了した時 | 検証チェックリストの完了を確認 |
| `TeammateIdle` | エージェントチームメンバーがアイドル状態になった時 | アイドル状態のチームメイトに未処理タスクの引き受けを促す |

### バックグラウンドエージェント

以下のエージェントはユーザーの操作なしに自動実行されます。結果は `.qe/` ファイルに書き込まれ、ユーザーに直接応答することはありません。

#### Erefresh-executor -- プロジェクト分析の同期

> `.qe/analysis/` を最新の状態に保ち、他のエージェントがコストの高いプロジェクトスキャンをスキップできるようにします。

| | 詳細 |
|---|---|
| **実行タイミング** | セッション開始時（データが古い場合）、Qrun-taskの前、または `/Qrefresh` で手動実行 |
| **書き込み先** | `.qe/analysis/*.md`、`.qe/changelog.md` |
| **トークン節約** | 約50%削減 -- エージェントが数十ファイルをスキャンする代わりに4つの分析ファイルを読み取り |

**ステップ：**
1. `git diff` とファイルシステムスキャンで変更を検出
2. 4つの分析ファイルを更新：`project-structure`、`tech-stack`、`entry-points`、`architecture`
3. `.qe/changelog.md` に `[External Change]` または `[QE]` タグ付きで変更履歴を記録

#### Ecompact-executor -- コンテキストの保存

> コンテキストコンパクション前に軽量スナップショットを保存し、セッションを再開可能にします。

| | 詳細 |
|---|---|
| **実行タイミング** | コンテキストウィンドウが75%以上に達した時（Yellowゾーン）、または `/Qcompact` で手動実行 |
| **書き込み先** | `.qe/context/snapshot.md`、`.qe/context/decisions.md` |
| **トークン節約** | 約70%削減 -- プロジェクトを再探索する代わりに数ファイルからコンテキストを復元 |

**ステップ：**
1. 進行中のタスク、チェックリストの状態、最近のファイル変更、主要な決定事項を収集
2. `.qe/context/snapshot.md` にスナップショットを保存（パスとサマリーのみ、コードなし）
3. `.qe/context/decisions.md` に決定事項を逆時系列で蓄積

#### Earchive-executor -- タスクのアーカイブ

> 完了したタスクをバージョン別アーカイブに移動し、ワークスペースをクリーンに保ちます。

| | 詳細 |
|---|---|
| **実行タイミング** | Qrun-taskがタスクを完了とマークした時、または `/Qarchive` で手動実行 |
| **書き込み先** | `.qe/.archive/vX.Y.Z/tasks/`、`.qe/.archive/vX.Y.Z/checklists/` |

**ステップ：**
1. `.qe/tasks/pending/` から完全に完了したタスクをスキャン
2. 完了したTASK_REQUESTとVERIFY_CHECKLISTを `.qe/.archive/vX.Y.Z/` に移動
3. アーカイブファイルとともにCLAUDE.mdのスナップショットを保存

#### Ecommit-executor -- 自動コミット

> AI痕跡ゼロの人間スタイルのコミットを作成します。

| | 詳細 |
|---|---|
| **実行タイミング** | `/Qcommit` からの委譲、またはQrun-task完了後の自動コミット |
| **禁止事項** | `Co-Authored-By` 行、AI関連の文言、絵文字 |

**ステップ：**
1. `git diff` を分析し、プロジェクトの既存コミットメッセージスタイルに合わせる
2. 関連ファイルを選択的にステージング（`.env`、認証情報は除外）
3. 人間が書いたものと区別がつかないコミットを作成

#### Eprofile-collector -- ユーザーパターンの学習

> ユーザーの好みを時間をかけて学習し、インテント認識の精度を向上させます。

| | 詳細 |
|---|---|
| **実行タイミング** | スキルまたはエージェントの完了後 |
| **書き込み先** | `.qe/profile/command-patterns.md`、`writing-style.md`、`corrections.md`、`preferences.md` |

**収集内容：**

| ファイル | 内容 |
|----------|------|
| `command-patterns.md` | スキル/エージェントの呼び出し頻度と直近の使用状況 |
| `writing-style.md` | フォーマル/インフォーマルのパターン、略語辞書 |
| `corrections.md` | 誤解の繰り返しを防ぐためのユーザー修正履歴 |
| `preferences.md` | 応答の長さ、コードスタイル、言語の好み |

#### Ehandoff-executor -- セッションハンドオフ

> シームレスなクロスセッション継続のためのバリデーション済みハンドオフ文書を生成します。

| | 詳細 |
|---|---|
| **実行タイミング** | `/Qcompact`（ハンドオフモード）で手動実行 |
| **書き込み先** | `.qe/handoffs/HANDOFF_{date}_{time}.md` |

**ステップ：**
1. タスクの状態、チェックリストの進捗、最近のgit変更、決定事項を収集
2. 具体的な次のステップを含む構造化されたハンドオフ文書を生成
3. 参照されているすべてのファイルとタスクUUIDが実際に存在することを検証

#### Edoc-generator -- バッチドキュメント生成

> 重いドキュメント生成をメインコンテキストウィンドウからオフロードします。

| | 詳細 |
|---|---|
| **実行タイミング** | Epm-planner、Qrun-task（`type: docs`）、または複数ドキュメントリクエストからの委譲 |
| **対応フォーマット** | `.docx`、`.pdf`、`.pptx`、`.xlsx` |

テンプレートが利用可能な場合はそれを使用し、複数のドキュメントを並列処理します。

---

## Agents (22)

エージェントはタスクの複雑さに基づいてモデルティアが自動的に割り当てられます。詳細は [AGENT_TIERS.md](../core/AGENT_TIERS.md) を参照してください。

### HIGH ティア (opus)

| エージェント | 説明 |
|-------------|------|
| Edeep-researcher | 技術比較と意思決定支援のための体系的マルチステップリサーチエージェント。 |
| Eqa-orchestrator | テスト、レビュー、修正の完全な品質ループを実行。メインコンテキストを保護。 |
| Esupervision-orchestrator | 監理オーケストレーター。ドメイン別監理エージェントにルーティングし、PASS/PARTIAL/FAILの評価を集約。FAILの場合はREMEDIATION_REQUESTを自動生成。 |

### MEDIUM ティア (sonnet)

| エージェント | 説明 |
|-------------|------|
| Etask-executor | チェックリスト項目を順番に実装。独立した項目にはWaveベースの並列実行をサポート。 |
| Ecode-debugger | デバッグ専門。バグの根本原因分析、エラー追跡、トラブルシューティング。 |
| Ecode-reviewer | コードレビュー専門。品質、セキュリティ、パフォーマンス、パターン準拠をレビュー。 |
| Ecode-test-engineer | テストエンジニア。テスト作成、カバレッジ分析、テスト戦略を担当。 |
| Ecode-doc-writer | テクニカルドキュメント専門。コード解説、APIドキュメント、READMEを作成。 |
| Ecode-quality-supervisor | コード品質監査の監理エージェント。コード品質、テストカバレッジ、アーキテクチャの一貫性をレビュー。PASS/PARTIAL/FAILを返却。 |
| Edocs-supervisor | ドキュメント監査の監理エージェント。完全性、正確性、構造的一貫性、リンクの有効性をレビュー。PASS/PARTIAL/FAILを返却。 |
| Eanalysis-supervisor | 分析監査の監理エージェント。証拠の十分性、論理的妥当性、スコープの適切性、実行可能性をレビュー。PASS/PARTIAL/FAILを返却。 |
| Esecurity-officer | セキュリティ監査専門。git diffの変更を脆弱性スキャンし、PASS/WARN/FAILに分類。 |
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

## Agent Teams（実験的）

QE Frameworkは、並列コラボレーションが有効な複雑なタスクのために[Claude Agent Teams](https://code.claude.com/docs/en/agent-teams)をサポートしています。Agent Teamsは複数のClaudeインスタンスを生成し、直接通信してタスクリストを共有します。

### Teams起動条件

機能が有効で、タスクが複雑度の閾値を満たすと自動的にTeamsが起動されます：

| エージェント | Teamトリガー | Team構成 |
|-------------|-------------|----------|
| Eqa-orchestrator | 3つ以上のテスト/ソースグループ | Test Engineer + Code Reviewerの並列 |
| Etask-executor | 5つ以上の独立チェックリスト項目 | ファイルグループごとに1チームメイト |
| Edeep-researcher | 3つ以上の研究ソース/観点 | Researchers + Devil's Advocate |

### Agent Teamsの有効化

`.claude/settings.json`に追加：
```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

Agent Teamsが有効でない場合、すべてのエージェントは既存のSubagent動作にフォールバックします。

詳細な設定とチームパターンについては[AGENT_TEAMS.md](../core/AGENT_TEAMS.md)を参照してください。

## プロジェクト構成

```
qe-framework/
├── .claude-plugin/    # プラグイン設定
├── agents/            # 22 agents (E-prefix)
├── skills/            # 65 core + 72 coding expert skills (Q-prefix)
├── core/              # 共有原則と設定
├── hooks/             # ライフサイクルフック
├── install.js         # インストールスクリプト
└── package.json
```

## ライセンス

UNLICENSED
