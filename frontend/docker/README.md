Runtime env injection for frontend Docker image

Usage (build):

```sh
docker build -t my-frontend:latest --build-arg REACT_APP_API_URL=http://api:5000 -f docker/Dockerfile .
```

Runtime (override value without rebuilding):

```sh
docker run -e REACT_APP_API_URL=http://api:5000 -p 80:80 my-frontend:latest
```

Notes:
- `entrypoint.sh` writes `/env.js` into the served files so the app can read `window._env_.REACT_APP_API_URL` at runtime.
- The frontend will prefer the runtime `window._env_.REACT_APP_API_URL` over the build-time `process.env.REACT_APP_API_URL`.
