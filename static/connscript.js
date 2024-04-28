
$(document).ready(function() {
    $('#submitBtn').click(function() {
        var username = $('#username').val();
        var server = $('#server').val();
        var port = $('#port').val();
        var passwd = $('#passwd').val();
        var sshkey = $('#sshkey').val();

        // Eksik alanları kontrol et
        if (!username || !server || !port || !passwd || !sshkey) {
            alert('Hata: Eksik alanlar var');
            return; // Eksik alanlar varsa işlemi durdur
        }
        var data = JSON.stringify({username: username,
                                    server: server,
                                    port: port,
                                    passwd: passwd,
                                    sshkey: sshkey});
        $.ajax({
            type: 'POST',
            url: '/submit',
            contentType: 'application/json',
            data: data,
            success: function(response) {
                console.log('Başarılı:', response);
            },
            error: function(xhr, status, error) {
                console.error('Hata:', error);
            }
        });
    });
});