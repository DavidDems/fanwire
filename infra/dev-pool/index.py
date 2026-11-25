def lambda_handler(event, context):
    event["response"]["autoConfirmUser"] = True
    event["response"]["autoVerifyEmail"] = False
    return event
