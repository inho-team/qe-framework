# QE Framework

QE Framework 是面向 Claude Code 和 Codex 的 Plan 驱动执行与验证框架。

```text
Claude: /Qplan "实现账户恢复"
Codex:  $Qplan "实现账户恢复"
```

`Qplan` 会在内部完成知识检索、规格、执行、验证和监督。`Qgenerate-spec` 和 `Qexecute` 是已安装的内部阶段，不是用户命令。

公开技能：`Qgoal`, `Qplan`, `Qcritical-review`, `Qcommit`, `Qcompact`, `Qresume`, `Qupdate`, `Qversion`, `Qdashboard`, `Qcc-setup`。

请参阅 [INSTALL.md](INSTALL.md) 和 [USAGE_GUIDE.md](USAGE_GUIDE.md)。
