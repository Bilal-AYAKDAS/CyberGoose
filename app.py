from flask import Flask, jsonify,request
from flask_cors import CORS
from server_connection import FTPOperations
from db import DbMyFtp
import os_folder as mycomp

app = Flask(__name__)
CORS(app)  # Tüm kaynaklardan gelen isteklere izin verir

servers_dirs = dict()
serverConn = None

@app.route('/')
def index():
    return open('template/index.html', encoding='utf-8').read()

@app.route('/serverconnection.html')
def serverconnection():
    return open('template/serverconnection.html', encoding='utf-8').read()


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
    return jsonify(servers_dirs)

@app.route('/api/compdirs', methods=['GET'])
def getCompDirList():
    mycompDirlists = mycomp.list_files("C:\\Users\\bilalayakdas\\Desktop\\FtpDirectory")
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
        global serverConn
        serverConn = FTPOperations(server, int(port), username, password)
    except Exception as e:
        print(e)
        return False
    getDirs(serverConn)
    return True

@app.route('/api/localfiles', methods=['POST'])
def localfiles():
    if request.method == 'POST':
        if request.headers['Content-Type'] == 'application/json':
            data = request.json
            filepath = data.get('filepath')
            mycompDirlists = mycomp.list_files(str(filepath))
            print("GELDİM 4")
            print(mycompDirlists)
    return jsonify(mycompDirlists)
    
@app.route('/api/uploadFile', methods=['POST'])
def uploadFile():
    if request.method == 'POST':
        # Gelen isteğin JSON içeriğini kontrol edelim
        if request.headers['Content-Type'] == 'application/json':
            # JSON içeriğini alalım
            data = request.json
            serverpath = "/htdocs/"
            folderPath = data.get('folderPath')
            fileName = data.get('fileName')
            print(folderPath)
            print(fileName)
            global serverConn
            serverConn.dosya_yukle(serverpath+fileName,folderPath+"\\"+fileName)
            getDirs(serverConn)
    return jsonify("mycompDirlists")

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5502,debug=True)
