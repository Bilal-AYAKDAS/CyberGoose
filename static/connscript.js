
$(document).ready(function() {
    $('#submitBtn').click(function() {
        var username = $('#username').val();
        var server = $('#server').val();
        var port = $('#port').val();
        var passwd = $('#passwd').val();
        var sshkey = $('#sshkey').val();;
        if (!username || !server || !port || !passwd) {
            if(!sshkey){
                alert('Hata: Eksik alanlar var');
                return; 
            }else{
                //sshkey ile bağlan
            }
            
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
                var isTrue =response.trim();
                console.log('Başarılı:', response);
                if(isTrue=="True"){
                    console.log("geldim");
                    window.opener.getServersFiles();

                }
            },
            error: function(xhr, status, error) {
                console.error('Hata:', error);
            }
        });
    });
});