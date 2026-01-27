import time


def run_fft(**kwargs):
    """Fake FFT process."""
    print("Running FFT...")
    time.sleep(5)
    print("FFT complete")
    return {"status": "success"}


def run_inversion(**kwargs):
    """Fake inversion process."""
    print("Running inversion...")
    time.sleep(10)
    print("Inversion complete")
    return {"status": "success"}


def run_create_environment(**kwargs):
    """Fake environment creation."""
    print("Creating environment...")
    time.sleep(15)
    print("Environment created")
    return {"status": "success"}
