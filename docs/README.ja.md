# QE Framework

QE Framework は Claude Code と Codex 向けの Plan 主導の実行・検証フレームワークです。

```text
Claude: /Qplan "アカウント復旧を実装"
Codex:  $Qplan "アカウント復旧を実装"
```

`Qplan` が知識取得、仕様化、実行、検証を内部で進めます。`Qgenerate-spec` と `Qexecute` は内部ステージであり、ユーザーコマンドではありません。

公開スキル: `Qgoal`, `Qplan`, `Qcritical-review`, `Qcommit`, `Qcompact`, `Qresume`, `Qupdate`, `Qversion`.

詳細は [INSTALL.md](INSTALL.md) と [USAGE_GUIDE.md](USAGE_GUIDE.md) を参照してください。
