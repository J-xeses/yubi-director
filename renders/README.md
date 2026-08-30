# renders/

유비 디렉터의 렌더 결과 로컬 저장 폴더.

앱은 Vercel 서버리스에서 돌기 때문에 로컬 디스크에 직접 쓸 수 없다.
최종 mp4는 **Vercel Blob**(`renders/{타임스탬프}.mp4`, public)에 올라가고,
아래 스크립트로 이 폴더에 내려받는다.

```bash
node scripts/pull-renders.mjs          # 아직 없는 것만
node scripts/pull-renders.mjs --all    # 전부 다시
```

- 이 폴더의 mp4/이미지 등 결과물은 git 추적 제외(.gitignore). README와 .gitkeep만 커밋.
- Blob 원본 관리·삭제는 Vercel 대시보드 → yubi-director → Storage.
