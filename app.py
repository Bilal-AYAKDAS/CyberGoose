from flask import Flask, jsonify,request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)  # Tüm kaynaklardan gelen isteklere izin verir

@app.route('/')
def index():
    return open('template/index.html', encoding='utf-8').read()

@app.route('/serverconnection.html')
def serverconnection():
    return open('template/serverconnection.html', encoding='utf-8').read()

# Örnek veri
ornek_veri = [
    {"id": 1, "isim": "Örnek 1", "deger": 10},
    {"id": 2, "isim": "Örnek 2", "deger": 20},
    {"id": 3, "isim": "Örnek 3", "deger": 30}
]

@app.route('/api/veri', methods=['GET'])
def veri_getir():
    return jsonify(ornek_veri)

@app.route('/submit', methods=['POST'])
def submit():
    if request.method == 'POST':
        if request.headers['Content-Type'] == 'application/json':
            data = request.json
            username = data.get('username')
            server = data.get('server')
            port = data.get('port')
            passwd = data.get('passwd')
            sshkey = data.get('sshkey')
            print('Kullanıcı Adı:', username)
            # Verileri işle
            if username and server and port and passwd and sshkey:
                print('Gelen Veriler:', data)
                return jsonify({'message': 'Veri alındı'})
            else:
                return jsonify({'error': 'Eksik alanlar'})
        else:
            return jsonify({'error': 'İçerik tipi "application/json" değil'})



if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5500,debug=True)
