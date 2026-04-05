# 일정 관리 (cursor-schedule1)

모바일 우선 일정·기념일·검색·브라우저 알림을 지원하는 정적 웹앱입니다. 데이터는 **브라우저 `localStorage`**에만 저장되며 별도 서버 비용이 없습니다.

## 개발

```bash
npm install
npm run dev
```

## 빌드

```bash
npm run build
```

결과물은 `dist/` 폴더입니다.

## GitHub

```bash
git remote add origin https://github.com/kiuza1004/cursor-schedule1.git
git branch -M main
git push -u origin main
```

## Vercel 배포

1. [Vercel](https://vercel.com)에서 GitHub 저장소를 Import합니다.
2. Framework Preset: **Vite**, Build Command: `npm run build`, Output Directory: `dist` (자동 감지되는 경우가 많습니다).
3. Deploy 후 HTTPS로 접속합니다.

알림은 **HTTPS**와 브라우저 **알림 권한**이 있어야 동작합니다. 탭이 닫혀 있으면 OS·브라우저 정책에 따라 알림이 제한될 수 있습니다.
