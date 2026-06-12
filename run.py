from ptcg_gallery import create_app

app = create_app()

if __name__ == "__main__":
    port = app.config["PORT"]
    host = app.config["HOST"]
    try:
        from waitress import serve
        import logging

        # 仅 queue depth > 5 时打印 WARNING
        queue_logger = logging.getLogger("waitress.queue")
        queue_logger.setLevel(logging.WARNING)

        class QueueDepthFilter(logging.Filter):
            def filter(self, record):
                # 只让 depth > 5 的日志通过
                msg = record.getMessage()
                if "depth is" in msg:
                    try:
                        depth = int(msg.rsplit(" ", 1)[-1])
                        return depth > 5
                    except ValueError:
                        pass
                return True

        queue_logger.addFilter(QueueDepthFilter())

        serve(app, host=host, port=port)
    except Exception:
        app.run(host=host, port=port, debug=True)

