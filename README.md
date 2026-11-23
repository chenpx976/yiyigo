# 弈意 · 棋有呼吸

可在浏览器中游玩的围棋游戏。Three.js + TypeScript + Vite；气、势、连接、打吃始终融入默认棋盘，没有单独的教学视图。

线上试玩：[弈意 · 棋有呼吸](https://chenpx976.github.io/yiyigo/) · [GitHub 源码](https://github.com/chenpx976/yiyigo)

## 本地运行

Node.js 22.12+（本次使用 24.15）。首次运行：

```sh
npm ci
npm run dev
```

打开 http://127.0.0.1:4173/ 。服务只监听本机回环地址，不暴露到局域网。终端中 Ctrl+C 停止。后续只需 `npm run dev`。

```sh
npm run typecheck  # TypeScript strict 类型检查
npm test           # Node test runner + tsx，规则/局部策略/棋谱回归
npm run build      # 类型检查并生成静态 dist/
npm run check      # 类型检查 + 测试 + 构建
npm run preview    # 在 127.0.0.1:4174 预览已构建版本
```

## GitHub Pages 发布

`main` 保存源码；`gh-pages` 保存经过类型检查、测试和构建的静态游戏。Pages 发布源为 `gh-pages` 分支根目录，`.nojekyll` 禁用 Jekyll 转换。保留 Vite 的相对 `base: "./"`，支持 `/yiyigo/` 子路径，包括真实棋谱和陪练 Worker。

已配置 GitHub Git 凭据后，后续更新：

```sh
git add <changed-files>
git commit -m "Describe the change"
git push origin main
npm run deploy:pages
```

发布脚本要求干净的 `main`，并核对源码已推送；在临时目录内生成部署提交，保留发布历史，普通 push，不改动本地源码分支。首次发布后须将仓库 Settings → Pages 的源设为上述分支；当前仓库已配置。`build-info.json` 可核对线上对应的源码提交。

Pages 只发布 `dist/`。开发验收 HTML、测试、设计文档和截图保存在源码仓库，本地运行时使用。`.openai/hosting.json` 仅保留历史站点身份，当前 GitHub Pages 发布不使用它。

## 模块

| 文件 | 职责 |
| --- | --- |
| `src/engine.ts` | 纯规则、棋块/气、提子、全局同形禁止、SGF 主线、单手分析；不依赖 DOM 或渲染器 |
| `src/position.ts` | 棋盘地理、边界影响传播、局部气紧提示、基础陪练策略 |
| `src/board.ts` | Three.js 场景、固定正交相机、光照阴影、气点、动画及可访问落点 |
| `src/connection-state.ts` | 虚连局部受压判断、打吃衰减与 0.7 秒连续过渡 |
| `src/living-stones.ts` | 棋格代理面、几何记录纹理、GPU 动画生命周期 |
| `src/implicit-stones.ts` | 完整三维距离场、射线求交、曲面法线与同源阴影 |
| `src/table-scene.ts` | 实体棋桌、厚棋盘、旋转曲面棋盒和盒内棋子 |
| `src/surface-model.ts` | 棋子/实连/虚连几何、空间分区和核心融合参数；详见 `CONNECTIONS.md` |
| `src/main.ts` | 自由对局、回放、存档、导入导出与界面状态 |
| `src/bot.worker.ts` | 后台陪练计算；悔棋/新局/切换模式时取消，防止旧结果落到新棋局 |
| `public/games/` | 随项目本地提供的真实 SGF 与许可，无运行时第三方棋谱依赖 |

真实棋谱与评注来自 [Go Game Guru / An Younggil](https://github.com/gogameguru/commented-go-games)，保留 [CC BY-NC-SA 4.0 许可](public/games/LICENSE.txt) 及原始 SGF 署名；当前线上版本为非商业演示。

依赖版本与完整解析结果保存在 `package-lock.json`。不使用 CDN、第三方字体或线上 API；安装后可断网运行（外部棋谱来源链接除外）。

## 棋盘表现

- 棋子、实连和虚连进入同一个距离场，先融合轮廓，再统一着色；不再把圆盘覆盖在线条上。每颗棋子保留实际圆顶和厚度，黑白共用三维法线着色流程，以漫反射塑形、弱镜面反射表达光泽。
- 正交实连采用稳定宽通道，真正“拉通”；打吃也不会降级为细丝。小尖、一间跳、二间跳保持直向细腰与竖向下垂，不共享气；小飞默认不画丝，关注真实棋块时才展开弱候选。
- 虚连在距离、气紧及断点占用变化时收束、开口、退缩；连接颜色不随状态变化。提子时棋子与根部共同收缩，结束后不残留悬空拉丝。
- 根部截面与切线匹配固定棋身，多个附属体积先取包络再与本体合并。黑白表面分开计算，不互相融合；潜在连接的强弱仍是局部启发式，并非战术安全评级。
- 气点轻微呼吸，打吃由气数和最后一气提示；落点预览显示合法提子、打吃、自紧气和连接。
- 落子微缓动、被提棋子与根部共同收缩；支持系统减少动态效果，页面隐藏时暂停动画。
- 势场以棋子为固定边界，在实际棋盘邻接图上传播并衰减。黑白独立传播，保留差值、总影响和对峙量，区分强对峙与空白；棋盘边界参与传播，但绝不增加棋子的气。
- 指向角边时沿真实边界亮起短线，并解释所在路数与局部急所。这里没有人为给角上增加气数或胜率。
- Three.js 负责实体场景与正俯视二维视角，透明 HTML 按钮负责鼠标、触屏与键盘落点。Tab 进入棋盘，方向键移动，Enter/空格落子。

## 当前三维实现

Three.js WebGLRenderer + 正俯视 OrthographicCamera。棋子与连接统一为三维隐式曲面，通过片元射线步进求表面交点，并写入真实深度；不再使用独立棋子网格叠加二维高度带。基础棋身保持固定的圆润椭球，变形只作用于连接材料。实连为低位宽截面，虚连两端贴合棋身、中段收细并下垂。customDepthMaterial 从光源方向查询同一三维场，阴影与表面共用动画数据。棋桌、棋盘和棋盒仍为常规实体网格。

开发几何检查页：`http://127.0.0.1:4173/dev/surface-review.html`。它将同一组棋子从正俯视与斜俯视同时显示，用于检查截面与投影，不是游戏教学视图，也不改变正式棋盘视角。

## 气脉回归库

“气脉”是本项目将气、实连、虚连及其受压/切断/拉通过渡融入棋盘的功能名称。虚连强弱是局部启发式，不承诺战术成立、活棋或成眼。

运行 `npm run test:qi-mai` 检查专项回归；`npm run check` 执行完整检查。开发服务器启动后打开 `/dev/qi-mai-review.html`：64 份人工 SGF、黑白对照、单步阶段、70 毫秒快速落子/悔棋，以及逐份下载。棋谱和独立预期断言保存在 `public/qi-mai/`，真实冠军棋谱继续使用 `public/games/`。详细审查与扩展约定见 `QI_MAI_REVIEW.md`。

SGF 导入支持根节点 AB/AW 摆子与 PL 行棋方；中途编辑棋盘、压缩摆子范围会明确拒绝，不会静默读错。回归棋谱可以通过正常导入入口查看。
