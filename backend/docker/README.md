Build and run the backend image

Build:
```sh
docker build -t notes-backend:latest -f docker/Dockerfile .
```

Run (example with envs):
```sh
docker run -e MONGO_URI="mongodb+srv://username:password@notesapp-cluster.mongodb.net/?appName=notesapp-cluster" -e JWT_SECRET="abc123" -p 5000:5000 notes-backend:latest
```

If you use Docker Compose, set the `MONGO_URI` env in the service or rely on a linked mongo service.
