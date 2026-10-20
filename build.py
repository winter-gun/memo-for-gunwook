"""외부 서비스 API 없는 메모 앱과 아이폰 홈 화면 설치 파일을 준비합니다."""
from pathlib import Path
import shutil
root = Path(__file__).resolve().parent
html = (root / 'src/shell.html').read_text(encoding='utf-8')
for marker, name in [('/*__MEMO_CORE__*/', 'memo-core.js'), ('/*__IMAGE_EXPORT__*/', 'image-export.js'), ('/*__APP__*/', 'app.js'), ('/*__PWA__*/', 'pwa.js')]:
    content = (root / 'src' / name).read_text(encoding='utf-8')
    assert '</script' not in content.lower(), f'Unsafe script terminator in {name}'
    html = html.replace(marker, content)
target = root / 'docs/index.html'
target.parent.mkdir(exist_ok=True)
target.write_text(html, encoding='utf-8')
for asset in (root / 'src/pwa').iterdir():
    if asset.is_file():
        shutil.copy2(asset, target.parent / asset.name)
(target.parent / '.nojekyll').touch()
print(f'Built {target} ({target.stat().st_size:,} bytes)')
