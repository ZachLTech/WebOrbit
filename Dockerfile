FROM golang:1.21-bullseye AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

# Copy the source code
COPY . .

# Build the application
RUN CGO_ENABLED=0 GOOS=linux go build -o weborbit .

# Use distroless as minimal base image to package the application
# https://github.com/GoogleContainerTools/distroless
FROM gcr.io/distroless/static-debian11

WORKDIR /

# Copy the binary and static files from the builder stage
COPY --from=builder /app/weborbit /weborbit
COPY --from=builder /app/static /static

# Expose the port
EXPOSE 8080

# Non-root user for better security
USER nonroot:nonroot

# Command to run
ENTRYPOINT ["/weborbit"]
