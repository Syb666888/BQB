# User meme folder

Put your real meme images in this folder, then register them in `manifest.json`.

The browser cannot automatically scan this folder in a pure static frontend, so every image needs one manifest entry.

Example:

```json
[
  {
    "src": "assets/user-memes/your-file-name.jpg",
    "title": "举手发言",
    "actions": ["single_hand_up"],
    "keywords": ["举手", "抢答"],
    "weight": 3
  }
]
```

Supported actions:

- `single_hand_up`: 举单手
- `both_hands_up`: 举双手
- `hands_on_head`: 双手抱头
- `arms_open`: 摊手 / 张开双臂
- `leaning`: 身体倾斜
- `neutral`: 普通站立
- `unknown`: 未识别兜底

Recommended image names should use letters, numbers, and hyphens, for example:

- `wechat-raise-hand-01.jpg`
- `douyin-arms-open-01.gif`
- `cat-leaning-01.webp`
