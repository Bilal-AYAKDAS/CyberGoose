from flask import Flask, jsonify,request
from flask_cors import CORS
from server_connection import FTPOperations
from db import DbMyFtp
import os_folder as mycomp


app = Flask(__name__)
CORS(app)  # Tüm kaynaklardan gelen isteklere izin verir

ornek_veri = [
    {"id": 1, "isim": "Örnek 1", "deger": 10},
    {"id": 2, "isim": "Örnek 2", "deger": 20},
    {"id": 3, "isim": "Örnek 3", "deger": 30}
]

servers_dirs = dict()


@app.route('/')
def index():
    return open('template/index.html', encoding='utf-8').read()

@app.route('/serverconnection.html')
def serverconnection():
    return open('template/serverconnection.html', encoding='utf-8').read()


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

            if username and server and port and passwd or sshkey:
                print('Gelen Veriler:', data)
                if(connectionserver(server, port, username,passwd)):
                    return "True"

                return jsonify({'message': 'Veri alındı'})
            else:
                return jsonify({'error': 'Eksik alanlar'})
        else:
            return jsonify({'error': 'İçerik tipi "application/json" değil'})

@app.route('/api/dirlist', methods=['GET'])
def getServerDirList():
    print("GELDİM")
    print(servers_dirs)
    return jsonify(servers_dirs)

@app.route('/api/compdirs', methods=['GET'])
def getCompDirList():
    mycompDirlists = mycomp.list_files("C:\\Users\\bilalayakdas\\Desktop\\FtpDirectory")
    print("GELDİM")
    print(mycompDirlists)
    return jsonify(mycompDirlists)

def getDirs(serverConn):
    global servers_dirs
    servers_dirs = serverConn.dosyalari_listele()
    print(servers_dirs)

def connectionserver(server, port, username, password):
    print("Server :", server)
    print("Port:", port)
    print("Username:", username)
    print("Password:",password)
    try:
        serverConn = FTPOperations(server, int(port), username, password)
    except Exception as e:
        print(e)
        return False
    getDirs(serverConn)
    return True
    
    
if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5502,debug=True)
