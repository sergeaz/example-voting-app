from flask import Flask, render_template, request, make_response, g, redirect, url_for
from redis import Redis
import os
import socket
import random
import json
import logging

DEFAULT_A = os.getenv('OPTION_A', "Cats")
DEFAULT_B = os.getenv('OPTION_B', "Dogs")
hostname = socket.gethostname()

app = Flask(__name__)

gunicorn_error_logger = logging.getLogger('gunicorn.error')
app.logger.handlers.extend(gunicorn_error_logger.handlers)
app.logger.setLevel(logging.INFO)

def get_redis():
    if not hasattr(g, 'redis'):
        g.redis = Redis(host="redis", db=0, socket_timeout=5)
    return g.redis

def _get_options_from_cookies(req):
    a = req.cookies.get('option_a')
    b = req.cookies.get('option_b')
    return (a, b)

@app.route("/", methods=['GET','POST'])
def hello():
    voter_id = request.cookies.get('voter_id')
    if not voter_id:
        voter_id = hex(random.getrandbits(64))[2:-1]

    # Check whether options are set (setup completed)
    option_a_cookie, option_b_cookie = _get_options_from_cookies(request)
    setup_done = bool(option_a_cookie and option_b_cookie)
    option_a = option_a_cookie or DEFAULT_A
    option_b = option_b_cookie or DEFAULT_B

    vote = None

    # Handle votes (only when setup_done)
    if request.method == 'POST' and 'vote' in request.form and setup_done:
        redis = get_redis()
        vote = request.form['vote']
        app.logger.info('Received vote for %s', vote)
        data = json.dumps({'voter_id': voter_id, 'vote': vote})
        redis.rpush('votes', data)

    resp = make_response(render_template(
        'index.html',
        option_a=option_a,
        option_b=option_b,
        hostname=hostname,
        vote=vote,
        setup_done=setup_done,
    ))
    resp.set_cookie('voter_id', voter_id)
    return resp

@app.route("/set_options", methods=['POST'])
def set_options():
    a = (request.form.get('option_a') or '').strip()
    b = (request.form.get('option_b') or '').strip()
    if not a or not b:
        # prefer redirecting back with a simple error param (template can show it)
        return redirect(url_for('hello'))
    resp = make_response(redirect(url_for('hello')))
    resp.set_cookie('option_a', a)
    resp.set_cookie('option_b', b)
    return resp

@app.route("/reset", methods=['POST','GET'])
def reset():
    resp = make_response(redirect(url_for('hello')))
    resp.set_cookie('option_a', '', expires=0)
    resp.set_cookie('option_b', '', expires=0)
    return resp

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=80, debug=True, threaded=True)
