# 表情包大赏

纯前端摄像头动作匹配表情包页面。

## 使用

1. 在项目目录启动静态服务器。
2. 打开 `http://127.0.0.1:5178/`。
3. 允许浏览器使用摄像头。
4. 做出动作后，页面会根据动作标签匹配 `assets/user-memes/manifest.json` 中的表情包。

## 表情包素材

真实素材放在 `assets/user-memes/`。

每张图需要在 `assets/user-memes/manifest.json` 中登记：

```json
{
  "src": "assets/user-memes/example.png",
  "title": "表情包标题",
  "actions": ["single_hand_up"],
  "keywords": ["关键词"],
  "weight": 3
}
```

支持的动作标签：

- `single_hand_up`
- `both_hands_up`
- `hands_on_head`
- `arms_open`
- `leaning`
- `neutral`
- `unknown`
