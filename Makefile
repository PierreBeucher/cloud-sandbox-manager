AWS_ACCESS_KEY=$(shell cat .aws_access_key)
AWS_SECRET_KEY=$(shell cat .aws_secret_key)

create:
	@AWS_ACCESS_KEY=${AWS_ACCESS_KEY} AWS_SECRET_KEY=${AWS_SECRET_KEY} ansible-playbook -i inventories/local playbook.yml