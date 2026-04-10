from flask import Flask, render_template, request, make_response, g, jsonify
from redis import Redis
import os
import socket
import random
import json
import logging

def env_defaults():
    return (os.getenv('OPTION_A', "Eagles"), os.getenv('OPTION_B', "Seahawks"))

app = Flask(__name__)

gunicorn_error_logger = logging.getLogger('gunicorn.error')
app.logger.handlers.extend(gunicorn_error_logger.handlers)
app.logger.setLevel(logging.INFO)

def get_redis():
    if not hasattr(g, 'redis'):
        g.redis = Redis(host="redis", db=0, socket_timeout=5)
    return g.redis

def get_options():
    redis = get_redis()
    a = redis.get('option_a')
    b = redis.get('option_b')
    a = a.decode('utf-8') if a else None
    b = b.decode('utf-8') if b else None
    default_a, default_b = env_defaults()
    return (a or default_a, b or default_b)

@app.route("/", methods=['POST','GET'])
def hello():
    voter_id = request.cookies.get('voter_id')
    if not voter_id:
        voter_id = hex(random.getrandbits(64))[2:-1]

    vote = None

    if request.method == 'POST':
        redis = get_redis()
        vote = request.form['vote']
        app.logger.info('Received vote for %s', vote)
        data = json.dumps({'voter_id': voter_id, 'vote': vote})
        redis.rpush('votes', data)

    option_a, option_b = get_options()
    resp = make_response(render_template(
        'index.html',
        option_a=option_a,
        option_b=option_b,
        hostname=hostname,
        vote=vote,
    ))
    resp.set_cookie('voter_id', voter_id)
    return resp


@app.route('/options', methods=['GET'])
def options_get():
    a, b = get_options()
    return jsonify({'option_a': a, 'option_b': b})


@app.route('/options', methods=['POST'])
def options_post():
    # Accept JSON or form-encoded body
    data = request.get_json(silent=True) or request.form
    a = data.get('option_a')
    b = data.get('option_b')
    if not a and not b:
        return jsonify({'error': 'no option_a or option_b provided'}), 400
    redis = get_redis()
    if a:
        redis.set('option_a', a)
        app.logger.info('Set option_a to %s', a)
    if b:
        redis.set('option_b', b)
        app.logger.info('Set option_b to %s', b)
    return jsonify({'option_a': a or redis.get('option_a').decode('utf-8'),
                    'option_b': b or redis.get('option_b').decode('utf-8')})

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=80, debug=True, threaded=True)
