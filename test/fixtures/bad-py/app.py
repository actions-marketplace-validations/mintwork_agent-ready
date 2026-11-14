import requests


def fetch(url):
    return requests.get(url).json()


def process(data, verbose=False):
    if verbose:
        print(data)
    return [d for d in data]


class Worker:
    def run(self, job):
        return process(fetch(job))
